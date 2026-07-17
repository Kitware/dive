from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
from subprocess import Popen
import tempfile
import threading
from typing import List, Optional, Tuple
from urllib import request
from urllib.parse import urlencode, urljoin

from girder_client import GirderClient
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_utils import constants, models, multicam_camera_order

TIMEOUT_COUNT = 'timeout_count'
TIMEOUT_LAST_CHECKED = 'last_checked'
TIMEOUT_CHECK_INTERVAL = 30


def make_directory(path: Path):
    path.mkdir(exist_ok=True, parents=True)
    return path


class CanceledError(RuntimeError):
    pass


def choose_annotation_fps(
    requested_fps,
    *,
    native_fps: Optional[float] = None,
    default_fps: float = 1.0,
) -> float:
    """Resolve annotation FPS from folder meta vs media native rate.

    ``requested_fps == -1`` means auto: use ``native_fps`` for video, else
    ``default_fps`` (image sequences). When a concrete folder fps is set (e.g.
    CSV import), keep it, capped by ``native_fps`` when provided.
    """
    if requested_fps == -1:
        annotation_fps = native_fps if native_fps is not None else default_fps
    elif native_fps is not None:
        annotation_fps = min(requested_fps, native_fps)
    else:
        annotation_fps = requested_fps
    if annotation_fps < 1:
        raise Exception('FPS lower than 1 is not supported')
    return annotation_fps


def fps_from_ffprobe_stream(video_stream: dict) -> Tuple[str, float]:
    """
    Return (fps_string, fps_float) from an ffprobe video stream dict.
    Prefer avg_frame_rate; fall back to r_frame_rate when avg is missing or 0/0
    (common for MPEG-TS and similar).
    """

    def _parse_rational(s: str) -> Optional[Tuple[int, int]]:
        if not s or s == "0/0":
            return None
        parts = s.split("/")
        if len(parts) != 2:
            return None
        try:
            num, den = int(parts[0]), int(parts[1])
        except ValueError:
            return None
        if den == 0:
            return None
        return num, den

    avg = str(video_stream.get("avg_frame_rate") or "")
    r_rate = str(video_stream.get("r_frame_rate") or "")

    pair = _parse_rational(avg)
    used = avg
    if pair is None:
        pair = _parse_rational(r_rate)
        used = r_rate
    if pair is None:
        raise Exception(
            "Could not determine frame rate from ffprobe "
            "(avg_frame_rate and r_frame_rate missing or unusable)"
        )
    num, den = pair
    return used, num / den


# ffprobe "format_name" is a comma-separated list of demuxer names. Only these
# are treated as browser-friendly when skip_transcoding is requested (H.264 in
# MPEG-TS / MPEG-PS is still h264 but must be remuxed — see convert_video).
# Matches dive-common websafeVideoTypes (mp4 / webm); other containers transcode.
_WEBSAFE_SKIP_TRANSCODE_FORMAT_FRAGMENTS = frozenset({'mp4', 'webm'})


def container_allows_skip_transcoding(format_name: str) -> bool:
    """
    True if ffprobe format_name indicates a container we can skip remuxing for
    (mp4 or webm demuxer tags, same as websafe video MIME types in the client).
    """
    if not format_name or not str(format_name).strip():
        return False
    parts = {p.strip() for p in str(format_name).split(',') if p.strip()}
    return bool(parts & _WEBSAFE_SKIP_TRANSCODE_FORMAT_FRAGMENTS)


def authenticate_urllib(gc: GirderClient):
    """Enable authenticated requests to girder backend using normal urllib"""
    opener = request.build_opener()
    opener.addheaders = [('Girder-Token', gc.token)]
    request.install_opener(opener)


def check_canceled(task: Task, context: dict, force=True):
    """
    Only check for canceled task every interval unless force is true (default).
    This is an expensive operation that round-trips to the message broker.
    """
    if not context.get(TIMEOUT_COUNT):
        context[TIMEOUT_COUNT] = 0
    now = datetime.now()
    if (
        (now - context.get(TIMEOUT_LAST_CHECKED, now)) > timedelta(seconds=TIMEOUT_CHECK_INTERVAL)
    ) or force:
        context[TIMEOUT_LAST_CHECKED] = now
        try:
            return task.canceled
        except (TimeoutError, ConnectionError) as err:
            context[TIMEOUT_COUNT] += 1
            print(
                f"Timeout N={context[TIMEOUT_COUNT]} for this task when checking for "
                f"cancellation. {err}"
            )
    return False


def describe_exit(code: int) -> str:
    """Describe a Popen return code, naming the signal for a kill."""
    if code < 0:
        try:
            name = signal.Signals(-code).name
        except ValueError:
            name = 'unknown signal'
        return f'was terminated by {name} ({-code})'
    return f'exited with nonzero status code {code}'


def stream_subprocess(
    task: Task,
    context: dict,
    manager: JobManager,
    popen_kwargs: dict,
    keep_stdout: bool = False,
) -> str:
    """
    Stream live results from process to job manager

    :param task: task to detect cancelation
    :param manager: job manager
    :param popen_kwargs: a dict to pass as kwargs to popen.  Must include 'args'
    :param keep_stdout: will return stdout as a string if needed
    """
    start_time = datetime.now()
    stdout = ""
    assert 'args' in popen_kwargs, "popen_kwargs must contain key 'args'"

    stop_event = threading.Event()

    def monitor_cancellation():
        """Thread that periodically checks for cancellation."""
        while not stop_event.wait(30):  # Check every 30 seconds
            manager.refreshStatus()
            if check_canceled(task, context, force=True) or manager.status == JobStatus.CANCELING:
                manager.write('\nCancellation detected. Stopping subprocess...\n', forceFlush=True)
                process.send_signal(signal.SIGTERM)
                process.send_signal(signal.SIGKILL)
                process.send_signal(signal.SIGINT)
                return  # Stop the thread

    with tempfile.TemporaryFile() as stderr_file:
        manager.write(f"Running command: {str(popen_kwargs['args'])}\n", forceFlush=True)
        process = Popen(
            **popen_kwargs,
            stdout=subprocess.PIPE,
            stderr=stderr_file,
        )

        if process.stdout is None:
            raise RuntimeError("Stdout must not be none")

        # Start cancellation monitoring thread
        cancel_thread = threading.Thread(target=monitor_cancellation, daemon=True)
        cancel_thread.start()

        # call readline until it returns empty bytes
        for line in iter(process.stdout.readline, b''):
            # Pipeline tools may emit Latin-1 / CP1252 (e.g. 0xa0 NBSP) in log lines.
            line_str = line.decode('utf-8', errors='replace')
            manager.write(line_str)
            if keep_stdout:
                stdout += line_str

        stop_event.set()
        cancel_thread.join()

        # flush logs
        manager._flush()
        # Wait for exit up to 30 seconds after kill
        code = process.wait(30)

        if check_canceled(task, context):
            manager.write('\nCanceled during subprocess run.\n')
            manager.updateStatus(JobStatus.CANCELED)
            raise CanceledError('Job was canceled')

        # Popen reports death by signal as a negative return code, so anything other
        # than 0 is a failure.  Treating only code > 0 as failure let a SIGKILLed
        # pipeline (-9, typically the OOM killer) report success, and callers then
        # ingested whatever partial or empty output file it left behind.
        if code != 0:
            stderr_file.seek(0)
            stderr = stderr_file.read().decode('utf-8', errors='replace')
            raise RuntimeError(f'Pipeline {describe_exit(code)}: {stderr}')
        else:
            end_time = datetime.now()
            manager.write(f"\nProcess completed in {str((end_time - start_time))}\n")

        return stdout


def download_revision_csv(gc: GirderClient, dataset_id: str, revision: int, path: Path):
    """Download CSV file for dataset @ revision"""
    args = {'folderId': dataset_id, 'revision': revision, 'excludeBelowThreshold': True}
    url = urljoin(urljoin(gc.urlBase, 'dive_annotation/export'), f'?{urlencode(args)}')
    request.urlretrieve(url, filename=path)


def download_source_media(
    girder_client: GirderClient, datasetId: str, dest: Path, force_transcoded=False
) -> Tuple[List[str], str]:
    """Download media for dataset to dest path"""
    media = models.DatasetSourceMedia(**girder_client.get(f'dive_dataset/{datasetId}/media'))
    dataset = models.GirderMetadataStatic(**girder_client.get(f'dive_dataset/{datasetId}'))
    if dataset.type == constants.ImageSequenceType:
        for frameImage in media.imageData:
            destination_path = dest / frameImage.filename
            url = urljoin(girder_client.urlBase, frameImage.url)
            request.urlretrieve(url, filename=destination_path)
        return [str(dest / image.filename) for image in media.imageData], dataset.type
    elif dataset.type == constants.VideoType and media.video is not None:
        if media.video and media.sourceVideo and not force_transcoded:
            destination_path = dest / media.sourceVideo.filename
        else:
            destination_path = dest / media.video.filename
        if media.video and media.sourceVideo and not force_transcoded:
            url = urljoin(girder_client.urlBase, media.sourceVideo.url)
        else:
            url = urljoin(girder_client.urlBase, media.video.url)
        request.urlretrieve(url, filename=destination_path)
        return [str(destination_path)], dataset.type
    else:
        raise Exception(f"unexpected metadata {str(dataset.dict())}")


def upload_zipped_flat_media_files(
    gc: GirderClient,
    manager: JobManager,
    folderId: str,
    working_directory: Path,
    create_subfolder=False,
):
    """Takes a flat folder of media files and/or annotation and generates a dataset from it"""
    listOfFileNames = os.listdir(working_directory)
    validation = gc.sendRestRequest('POST', '/dive_dataset/validate_files', json=listOfFileNames)
    root_folderId = folderId
    default_fps = gc.getFolder(root_folderId).get(f"meta.{constants.FPSMarker}", -1)
    if validation.get('ok', False):
        manager.write(f"Annotations: {validation['annotations']}\n")
        manager.write(f"Media: {validation['media']}\n")
        dataset_type = validation['type']
        manager.write(f"Type: {dataset_type}\n")
        if create_subfolder != '':
            sub_folder = gc.createFolder(
                folderId,
                create_subfolder,
                reuseExisting=True,
            )
            root_folderId = str(sub_folder["_id"])

        # Upload all resulting items back into the root folder
        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        # create a source folder to place the zipFile inside of
        gc.upload(f'{working_directory}/*', root_folderId)
        if dataset_type == constants.ImageSequenceType and default_fps == -1:
            default_fps = 1
        gc.addMetadataToFolder(
            str(root_folderId),
            {constants.TypeMarker: dataset_type, constants.FPSMarker: default_fps},
        )
        # After uploading the default files we do a the postprocess for video conversion now
        gc.sendRestRequest("POST", f"/dive_rpc/postprocess/{str(root_folderId)}")
    else:
        manager.write(f"Message: {validation['message']}\n")
        manager.write("Please check the documentation for Zip files at:\
                 https://kitware.github.io/dive/Web-Version/#zip-files\n")
        raise Exception("Could not Validate media Files")


def _load_exported_dataset_meta(working_directory: Path) -> dict:
    list_of_names = os.listdir(working_directory)
    potential_meta_files = list(filter(constants.metaRegex.match, list_of_names))
    if len(potential_meta_files) == 0:
        raise ValueError('Could not find meta.json or config.json in exported dataset folder')
    meta = {}
    for meta_name in potential_meta_files:
        with open(working_directory / meta_name) as f:
            meta = json.load(f)
    return meta


def _import_exported_dataset_directory(
    gc: GirderClient,
    manager: JobManager,
    dest_folder_id: str,
    working_directory: Path,
) -> None:
    """Import one exported single-camera dataset directory into dest_folder_id."""
    working_directory = Path(working_directory)
    list_of_names = os.listdir(working_directory)
    meta = _load_exported_dataset_meta(working_directory)
    dataset_type = meta[constants.TypeMarker]
    if dataset_type == constants.MultiType:
        raise ValueError(
            'Folder is a multicamera; use multicam zip import instead of single-dataset import'
        )
    if dataset_type == constants.ImageSequenceType:
        image_data = meta['imageData']
        for image in image_data:
            if image['filename'] not in list_of_names:
                raise ValueError(f'Could not find {image["filename"]} in exported dataset folder')
    elif dataset_type == constants.VideoType:
        video = meta['video']
        if video['filename'] not in list_of_names:
            raise ValueError(f'Could not find {video["filename"]} in exported dataset folder')
    else:
        raise ValueError(f'Unsupported exported dataset type: {dataset_type}')

    aux_path = working_directory / constants.AuxiliaryFolderName
    if aux_path.is_dir():
        shutil.rmtree(aux_path)

    manager.updateStatus(JobStatus.PUSHING_OUTPUT)
    gc.upload(f'{working_directory}/*', dest_folder_id)
    all_files = list(gc.listItem(dest_folder_id))
    root_meta = {
        'type': dataset_type,
        'attributes': meta.get('attributes', None),
        'customTypeStyling': meta.get('customTypeStyling', None),
        'customGroupStyling': meta.get('customGroupStyling', None),
        'confidenceFilters': meta.get('confidenceFilters', None),
        'imageEnhancements': meta.get('imageEnhancements', None),
        'fps': meta['fps'],
        'version': meta['version'],
    }
    if dataset_type == constants.VideoType:
        video = meta['video']
        transcoded_video = list(gc.listItem(dest_folder_id, name=video['filename']))
        if len(transcoded_video) == 1:
            ffprobe = meta['ffprobe_info']
            original_fps_string, original_fps = fps_from_ffprobe_stream(ffprobe)

            transcoded_metadata = {
                'codec': 'h264',
                'originalFps': original_fps,
                'originalFpsString': original_fps_string,
                'source_video': False,
                'transcoder': 'ffmpeg',
            }
            gc.addMetadataToItem(str(transcoded_video[0]['_id']), transcoded_metadata)
            for item in all_files:
                if (
                    item['name'].endswith(tuple(constants.validVideoFormats))
                    and item['name'] != video['filename']
                ):
                    source_metadata = {
                        'codec': ffprobe['codec_name'],
                        'originalFps': original_fps,
                        'originalFpsString': original_fps_string,
                        'source_video': False,
                    }
                    gc.addMetadataToItem(str(item['_id']), source_metadata)
            root_meta['originalFps'] = original_fps
            root_meta['originalFpsString'] = original_fps_string

    root_meta[constants.DatasetMarker] = True
    gc.addMetadataToFolder(dest_folder_id, root_meta)
    gc.post(f'dive_rpc/postprocess/{dest_folder_id}', data={'skipJobs': True})


def upload_exported_zipped_dataset(
    gc: GirderClient,
    manager: JobManager,
    folderId: str,
    working_directory: Path,
    create_subfolder='',
):
    """Uploads a folder that is generated from the export of a zip file and sets metadata."""
    working_directory = Path(working_directory)
    if (working_directory / constants.MultiCamJsonFileName).is_file():
        upload_exported_multicam_zipped_dataset(
            gc, manager, folderId, working_directory, create_subfolder
        )
        return
    try:
        dest_folder_id = folderId
        if create_subfolder != '':
            sub_folder = gc.createFolder(
                folderId,
                os.path.basename(create_subfolder),
                reuseExisting=True,
            )
            dest_folder_id = str(sub_folder['_id'])
        _import_exported_dataset_directory(gc, manager, dest_folder_id, working_directory)
    except ValueError as err:
        manager.write(f'{err}\n')
        raise Exception(str(err)) from err


def is_path_under_multicam_export(path: str, multicam_export_roots: set) -> bool:
    """True if path is a multicam export root or a file/folder inside one (e.g. camera subdirs)."""
    if not path:
        return False
    for root in multicam_export_roots:
        if path == root or path.startswith(f'{root}{os.sep}'):
            return True
    return False


def _multicam_camera_order(multi_cam: dict) -> List[str]:
    """Return camera names in display order (shared helper, matches the client)."""
    return multicam_camera_order(multi_cam)


def _upload_stereo_calibration_files(
    gc: GirderClient,
    manager: JobManager,
    folder_id: str,
    working_directory: Path,
) -> Optional[str]:
    calibration_item_id = None
    for entry in os.listdir(working_directory):
        entry_path = working_directory / entry
        if not entry_path.is_file():
            continue
        if not constants.stereoCalibrationRegex.search(entry):
            continue
        manager.write(f'Uploading calibration file {entry}\n')
        gc.upload(str(entry_path), folder_id)
        items = list(gc.listItem(folder_id, name=entry))
        if items:
            calibration_item_id = str(items[0]['_id'])
    return calibration_item_id


def upload_exported_multicam_zipped_dataset(
    gc: GirderClient,
    manager: JobManager,
    folderId: str,
    working_directory: Path,
    create_subfolder='',
):
    """
    Import a multicam dataset produced by dive_dataset export (multiCam.json + per-camera folders).
    """
    working_directory = Path(working_directory)
    multi_cam_path = working_directory / constants.MultiCamJsonFileName
    if not multi_cam_path.is_file():
        raise Exception(
            f'Exported multicam zip is missing {constants.MultiCamJsonFileName} at the dataset root'
        )

    with open(multi_cam_path) as f:
        multi_cam = json.load(f)
    parent_meta = _load_exported_dataset_meta(working_directory)

    default_display = multi_cam.get('defaultDisplay')
    cameras_meta = multi_cam.get('cameras') or {}
    camera_order = _multicam_camera_order(multi_cam)
    if not camera_order:
        raise Exception('multiCam.json does not list any cameras')
    if default_display not in cameras_meta:
        raise Exception(f'multiCam.json defaultDisplay "{default_display}" is not a camera name')

    sub_type = parent_meta.get(constants.SubTypeMarker)
    if sub_type not in ('stereo', 'multicam'):
        raise Exception(
            'Exported multicam dataset is missing subType "stereo" or "multicam" in meta.json'
        )

    parent_folder_id = folderId
    if create_subfolder != '':
        sub_folder = gc.createFolder(
            folderId,
            os.path.basename(create_subfolder),
            reuseExisting=True,
        )
        parent_folder_id = str(sub_folder['_id'])

    parent_folder = gc.getFolder(parent_folder_id)
    dataset_name = parent_folder['name']
    fps = parent_meta[constants.FPSMarker]

    imported_cameras: dict = {}
    media_type = None
    for camera_name in camera_order:
        camera_dir = working_directory / camera_name
        if not camera_dir.is_dir():
            raise Exception(f'Exported multicam zip is missing camera folder "{camera_name}"')
        child_meta = _load_exported_dataset_meta(camera_dir)
        cam_type = child_meta[constants.TypeMarker]
        if media_type is None:
            media_type = cam_type
        elif cam_type != media_type:
            raise Exception(f'Camera "{camera_name}" has type {cam_type}, expected {media_type}')
        manager.write(f'Importing camera "{camera_name}"…\n')
        child_folder = gc.createFolder(parent_folder_id, camera_name, reuseExisting=True)
        child_id = str(child_folder['_id'])
        _import_exported_dataset_directory(gc, manager, child_id, camera_dir)
        imported_cameras[camera_name] = {'folderId': child_id}

    calibration_file_id = None
    if sub_type == 'stereo':
        calibration_file_id = _upload_stereo_calibration_files(
            gc, manager, parent_folder_id, working_directory
        )

    create_body = {
        'name': dataset_name,
        'fps': fps,
        'type': media_type,
        'subType': sub_type,
        'defaultDisplay': default_display,
        'cameras': imported_cameras,
        'cameraOrder': camera_order,
    }
    if calibration_file_id:
        create_body['calibrationFileId'] = calibration_file_id

    manager.write('Finalizing multicamera dataset…\n')
    gc.sendRestRequest(
        'POST',
        '/dive_dataset/multicam',
        parameters={'parentFolderId': parent_folder_id},
        json=create_body,
    )
