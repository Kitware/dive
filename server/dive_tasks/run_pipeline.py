from contextlib import suppress
import os
from pathlib import Path
import shlex
import shutil
import tempfile
from typing import Dict, List, Optional, Tuple

from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_tasks import utils
from dive_tasks.manager import patch_manager
from dive_tasks.multicam_pipeline import (
    append_metadata_file_kwiver_settings,
    append_stereo_calibration_kwiver_settings,
    build_multicam_kwiver_settings,
    find_downloaded_calibration_file,
    is_stereo_measurement_pipeline,
)
from dive_tasks.registration_output import ingest_registration_output
from dive_tasks.pipeline_creates_dataset import (
    append_new_dataset_media_writers,
    is_transcode_pipeline,
    pipeline_creates_new_dataset,
    pipeline_renumbers_frames,
)
from dive_tasks.viame_config import Config
from dive_utils import constants, fromMeta
from dive_utils.types import GirderModel, MulticamCameraJob, MulticamPipelineJob, PipelineJob


def filter_csv_by_frame_range(csv_path: str, frame_range: Tuple[int, int]) -> str:
    """Filter VIAME CSV to only include detections within frame range.

    Args:
        csv_path: Path to the input CSV file
        frame_range: Tuple of (start_frame, end_frame) inclusive

    Returns:
        Path to the filtered CSV file
    """
    start_frame, end_frame = frame_range
    filtered_path = csv_path.replace('.csv', '_filtered.csv')

    with open(csv_path, 'r') as infile, open(filtered_path, 'w') as outfile:
        for line in infile:
            if line.startswith('#'):
                outfile.write(line)
                continue
            parts = line.split(',')
            if len(parts) >= 3:
                try:
                    frame = int(parts[2])  # Frame number is column 3 (0-indexed as column 2)
                    if start_frame <= frame <= end_frame:
                        outfile.write(line)
                except ValueError:
                    # If frame number can't be parsed, include the line
                    outfile.write(line)
    return filtered_path


def filter_image_list_by_frame_range(
    image_list: List[str], frame_range: Tuple[int, int]
) -> List[str]:
    """Filter an image list to only include images within frame range.

    Args:
        image_list: List of image file paths
        frame_range: Tuple of (start_frame, end_frame) inclusive (0-indexed)

    Returns:
        Filtered list of image file paths
    """
    start_frame, end_frame = frame_range
    # Ensure we don't go out of bounds
    start_frame = max(0, start_frame)
    end_frame = min(end_frame, len(image_list) - 1)
    return image_list[start_frame : end_frame + 1]


def _resolve_pipeline_path(
    conf: 'Config',
    gc: GirderClient,
    pipeline: dict,
    trained_pipeline_path: Path,
) -> Path:
    if pipeline["type"] == constants.TrainedPipelineCategory:
        gc.downloadFolderRecursive(pipeline["folderId"], str(trained_pipeline_path))
        return trained_pipeline_path / pipeline["pipe"]
    return conf.get_extracted_pipeline_path() / pipeline["pipe"]


def _append_frame_range_video_settings(
    command: List[str],
    input_folder: GirderModel,
    frame_range: Tuple[int, int],
    pipeline_pipe: str,
) -> None:
    command.append(f"-s downsampler:start_frame={shlex.quote(str(frame_range[0]))}")
    command.append(f"-s downsampler:end_frame={shlex.quote(str(frame_range[1]))}")
    input_fps = fromMeta(input_folder, constants.FPSMarker)
    original_fps = fromMeta(input_folder, constants.OriginalFPSMarker, default=None)
    is_native = original_fps is None or input_fps >= original_fps
    command.append(f"-s downsampler:frame_range_is_native={str(is_native).lower()}")
    renumber = pipeline_renumbers_frames(pipeline_pipe)
    command.append(f"-s downsampler:renumber_frames={str(renumber).lower()}")
    command.append(f"-s downsampler:adjust_timestamps={str(renumber).lower()}")


def _push_new_dataset_from_media(
    gc: GirderClient,
    manager: JobManager,
    params: PipelineJob,
    input_folder_id: str,
    output_path: Path,
    pipeline: dict,
    *,
    transcoded_video: Optional[str] = None,
) -> None:
    """Create a sibling dataset from KWIVER media output (filter/transcode/disparity)."""
    output_dataset_name = params.get('output_dataset_name') or (
        f"{pipeline.get('name', 'pipeline')}_output"
    )
    output_parent_folder_id = params.get('output_parent_folder_id')
    input_folder = gc.getFolder(input_folder_id)
    source_fps = fromMeta(input_folder, constants.FPSMarker, default=-1)

    if is_transcode_pipeline(pipeline) and transcoded_video:
        # Prefer uploading only the produced video via a dedicated staging dir
        # when other files may be present under output_path.
        staging = output_path / '_dataset_media'
        utils.make_directory(staging)
        video_path = Path(transcoded_video)
        if not video_path.exists():
            # Fallback: first mp4 under output_path
            videos = sorted(output_path.glob('*.mp4'))
            if not videos:
                raise Exception('Transcode pipeline produced no video file')
            video_path = videos[0]
        staged = staging / video_path.name
        if video_path.resolve() != staged.resolve():
            shutil.copy2(video_path, staged)
        utils.create_sibling_dataset_from_media(
            gc,
            manager,
            input_folder_id,
            staging,
            output_dataset_name,
            constants.VideoType,
            source_fps,
            parent_folder_id=output_parent_folder_id,
        )
        return

    utils.create_sibling_dataset_from_media(
        gc,
        manager,
        input_folder_id,
        output_path,
        output_dataset_name,
        constants.ImageSequenceType,
        source_fps,
        parent_folder_id=output_parent_folder_id,
    )


def _inject_dataset_metadata_file(command, gc, working_dir: Path, params, manager) -> None:
    """
    Download the dataset's optional metadata file (if the pipeline opted in) and
    append its `-s <key>=<path>` override. Shared by the single and multicam
    command-building branches.
    """
    metadata_file_item_id = params.get('metadata_file_item_id')
    metadata_file_key = params.get('metadata_file_key')
    if not (metadata_file_item_id and metadata_file_key):
        return
    md_item = gc.getItem(metadata_file_item_id)
    md_dir = utils.make_directory(working_dir / 'metadata_file')
    gc.downloadItem(metadata_file_item_id, str(md_dir), name=md_item.get('name'))
    # Locate what actually landed rather than reconstructing md_dir/<item name>: girder_client
    # nests the download under a directory of that name when the item's file is named differently
    # from the item (a sidecar renamed after upload), and it sanitizes the name with
    # transformFilename first. Both make the reconstructed path wrong -- and in the nested case it
    # is a directory, so an exists() check passes and binds a directory into the KWIVER setting.
    # md_dir is created fresh for this item, so anything under it is its content.
    downloaded = next((path for path in sorted(md_dir.rglob('*')) if path.is_file()), None)
    if downloaded is not None:
        append_metadata_file_kwiver_settings(command, downloaded, metadata_file_key)
    else:
        manager.write(
            f'Warning: metadata item {metadata_file_item_id} '
            f'has no downloadable file under {md_dir}\n'
        )


def _append_input_list_kwiver_settings(command, pipeline, image_lists) -> None:
    """
    Bind the run's per-camera input image lists to the KWIVER keys a pipe declares
    via `# Image List Keys:`. image_lists is one single-file, line-separated list
    per camera. A key template containing `{cam}` is expanded per camera (1-based)
    — e.g. `stabilizer:image_list{cam}` -> image_list1, image_list2, ...; a key
    without `{cam}` gets the first camera's list. Sea-lion registration needs the
    list here in addition to the input reader's video_filename.
    """
    if not image_lists:
        return
    for key in (pipeline.get('metadata') or {}).get('imageListKeys') or []:
        if '{cam}' in key:
            for idx, image_list in enumerate(image_lists, start=1):
                expanded = key.replace('{cam}', str(idx))
                command.append(f'-s {shlex.quote(expanded)}={shlex.quote(image_list)}')
        else:
            command.append(f'-s {shlex.quote(key)}={shlex.quote(image_lists[0])}')


def _find_stereo_calibration_outputs(output_dir: Path) -> List[Path]:
    """Return likely calibration outputs written by stereo calibration pipelines."""
    candidates: List[Path] = []
    for path in output_dir.iterdir():
        if not path.is_file():
            continue
        lower_name = path.name.lower()
        if 'calibration' not in lower_name:
            continue
        if not constants.stereoCalibrationRegex.search(path.name):
            continue
        candidates.append(path)
    return sorted(candidates, key=lambda p: p.name.lower())


@app.task(bind=True, acks_late=True, ignore_result=True)
def run_pipeline(self: Task, params: PipelineJob):
    conf = Config()
    conf.require_viame_install()
    context: dict = {}
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    gc: GirderClient = self.girder_client
    utils.authenticate_urllib(gc)
    manager.updateStatus(JobStatus.FETCHING_INPUT)

    # Extract params
    pipeline = params["pipeline"]
    input_folder_id = str(params["input_folder"])
    input_type = params["input_type"]
    output_folder_id = str(params["output_folder"])
    input_revision = params["input_revision"]
    force_transcoded = params.get('force_transcoded', False)
    runtime_params = params.get('runtime_params') or {}
    frame_range = runtime_params.get('frameRange')
    image_pairs = runtime_params.get('imagePairs')
    multicam_params: MulticamPipelineJob = params
    multicam_cameras: List[MulticamCameraJob] = multicam_params.get('multicam_cameras') or []
    camera_name = params.get('camera_name')
    if camera_name:
        # Log non-default camera targets so job history shows which view ran.
        default_display = multicam_params.get('multicam_default_display')
        if not default_display or camera_name != default_display:
            print(f'Running pipeline on camera: {camera_name}')
    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        _working_directory_path = Path(_working_directory)
        input_path = utils.make_directory(_working_directory_path / 'input')
        trained_pipeline_path = utils.make_directory(_working_directory_path / 'trained_pipeline')
        output_path = utils.make_directory(_working_directory_path / 'output')

        detector_output_file = str(output_path / 'detector_output.csv')
        track_output_file = str(output_path / 'track_output.csv')
        img_list_path = input_path / 'img_list_file.txt'

        pipeline_path = _resolve_pipeline_path(conf, gc, pipeline, trained_pipeline_path)

        assert pipeline_path.exists(), (
            "Requested pipeline could not be found."
            " Make sure that VIAME is installed correctly and all addons have loaded."
            f" Job asked for {pipeline_path} but it does not exist"
        )

        if multicam_cameras:
            input_folder = gc.getFolder(input_folder_id)
            input_fps = fromMeta(input_folder, constants.FPSMarker)
            requires_input = multicam_params.get('multicam_requires_input', False)
            creates_new_dataset = pipeline_creates_new_dataset(pipeline)
            camera_media: Dict[str, Tuple[List[str], str]] = {}

            for cam_index, camera in enumerate(multicam_cameras, start=1):
                cam_input_path = utils.make_directory(input_path / camera['name'])
                media_list, media_type = utils.download_source_media(
                    gc, camera['folder_id'], cam_input_path, force_transcoded
                )
                if frame_range is not None and media_type == constants.ImageSequenceType:
                    media_list = filter_image_list_by_frame_range(media_list, frame_range)
                camera_media[camera['name']] = (media_list, media_type)
                if requires_input and camera.get('input_revision') is not None:
                    gt_path = _working_directory_path / f'detections{cam_index}.csv'
                    utils.download_revision_csv(
                        gc, camera['folder_id'], camera['input_revision'], gt_path
                    )

            arg_file_pair, out_files = build_multicam_kwiver_settings(
                _working_directory_path,
                multicam_cameras,
                camera_media,
                requires_input=requires_input,
                image_pairs=image_pairs,
            )

            command = [
                f". {shlex.quote(str(conf.viame_setup_script))} &&",
                f"KWIVER_DEFAULT_LOG_LEVEL={shlex.quote(conf.kwiver_log_level)}",
                "viame runner",
                f"-p {shlex.quote(str(pipeline_path))}",
            ]
            if input_type == constants.VideoType:
                command.extend(
                    [
                        '-s input:video_reader:type=vidl_ffmpeg',
                        f"-s downsampler:target_frame_rate={shlex.quote(str(input_fps))}",
                    ]
                )
                if frame_range is not None:
                    _append_frame_range_video_settings(
                        command, input_folder, frame_range, pipeline['pipe']
                    )
            for arg, file_name in arg_file_pair.items():
                command.append(f"-s {shlex.quote(arg)}={shlex.quote(file_name)}")

            transcoded_video: Optional[str] = None
            if creates_new_dataset:
                video_name = None
                if is_transcode_pipeline(pipeline):
                    video_name = str(
                        output_path / f"{pipeline.get('name', 'transcode')}_{input_folder_id}.mp4"
                    )
                transcoded_video = append_new_dataset_media_writers(
                    command, pipeline, output_path, video_filename=video_name
                )

            calibration_item_id = multicam_params.get('calibration_item_id')
            if calibration_item_id and is_stereo_measurement_pipeline(pipeline):
                cal_item = gc.getItem(calibration_item_id)
                cal_dir = utils.make_directory(_working_directory_path / 'calibration')
                gc.downloadItem(
                    calibration_item_id,
                    str(cal_dir),
                    name=cal_item.get('name'),
                )
                cal_path = find_downloaded_calibration_file(cal_dir)
                if cal_path is not None:
                    append_stereo_calibration_kwiver_settings(command, cal_path, pipeline)
                else:
                    manager.write(
                        f'Warning: calibration item {calibration_item_id} '
                        f'has no recognized calibration file under {cal_dir}\n'
                    )

            # One image list per camera (each a single line-separated file).
            input_manifests = [
                arg_file_pair[f'input{i + 1}:video_filename']
                for i in range(len(multicam_cameras))
                if f'input{i + 1}:video_filename' in arg_file_pair
            ]
            _append_input_list_kwiver_settings(command, pipeline, input_manifests)

            _inject_dataset_metadata_file(command, gc, _working_directory_path, params, manager)

            is_align_pipeline = 'align_cameras' in pipeline['pipe']
            if is_align_pipeline:
                # Camera names for the output JSON, aligned with the
                # input{i} order used above.
                camera_names = ','.join(camera['name'] for camera in multicam_cameras)
                command.append(f'-s register:camera_names={shlex.quote(camera_names)}')

            kwiver_params = params.get('kwiver_params')
            if kwiver_params:
                for key, value in kwiver_params.items():
                    command.append(f'-s {shlex.quote(key)}={shlex.quote(str(value))}')

            manager.updateStatus(JobStatus.RUNNING)
            popen_kwargs = {
                'args': " ".join(command),
                'shell': True,
                'executable': '/bin/bash',
                'cwd': output_path,
                'env': conf.gpu_process_env,
            }
            utils.stream_subprocess(self, context, manager, popen_kwargs)

            if (
                is_stereo_measurement_pipeline(pipeline)
                and 'calibrate_cameras' in str(pipeline.get('pipe', '')).lower()
            ):
                calibration_outputs = _find_stereo_calibration_outputs(output_path)
                if calibration_outputs:
                    calibration_output = calibration_outputs[0]
                    try:
                        uploaded_calibration = gc.uploadFileToFolder(
                            input_folder_id,
                            str(calibration_output),
                        )
                        uploaded_calibration_file_id = uploaded_calibration.get('_id')
                        if uploaded_calibration_file_id is not None:
                            uploaded_calibration_file_id_str = str(uploaded_calibration_file_id)
                            cal_url = (
                                f'/dive_dataset/{input_folder_id}/calibration'
                                f'?fileId={uploaded_calibration_file_id_str}'
                            )
                            gc.sendRestRequest('POST', cal_url)
                            manager.write(
                                'Assigned calibration output to dataset: '
                                f'{calibration_output.name}\n'
                            )
                        else:
                            manager.write(
                                'Warning: uploaded calibration output '
                                f'{calibration_output.name} has no file id\n'
                            )
                    except Exception as exc:
                        manager.write(
                            'Warning: failed to assign calibration output '
                            f'{calibration_output.name}: {exc}\n'
                        )
                else:
                    manager.write(
                        'Warning: stereo calibration pipeline produced no '
                        'recognized calibration output file\n'
                    )

            if creates_new_dataset:
                manager.updateStatus(JobStatus.PUSHING_OUTPUT)
                _push_new_dataset_from_media(
                    gc,
                    manager,
                    params,
                    input_folder_id,
                    output_path,
                    pipeline,
                    transcoded_video=transcoded_video,
                )
                return

            manager.updateStatus(JobStatus.PUSHING_OUTPUT)
            if is_align_pipeline:
                # The register process writes its JSON atomically in the run
                # cwd (output_path); a canceled/failed job leaves no file, so
                # a file present here is a complete result. Substring sniff,
                # like the desktop collector.
                registration_files = [
                    path for path in output_path.iterdir()
                    if path.is_file()
                    and 'registration' in path.name.lower()
                    and path.suffix == '.json'
                ]
                if not registration_files:
                    manager.write('No registration output produced; see the log above.\n')
                    return
                registration_path = registration_files[0]
                # Keep the raw artifact with the dataset (provenance), then
                # merge it into the saved registration meta.
                newfile = gc.uploadFileToFolder(input_folder_id, str(registration_path))
                gc.addMetadataToItem(str(newfile['itemId']), {'pipeline': pipeline})
                merged = ingest_registration_output(gc, input_folder_id, registration_path)
                manager.write(
                    f'Merged camera registration for {merged} pair(s) into the dataset\n'
                )
                return
            for camera in multicam_cameras:
                cam_name = camera['name']
                output_name = out_files[cam_name]
                # Multicam KWIVER args use basename-only writers; viame cwd is output_path,
                # so CSVs are created under output/, not the temp directory root.
                output_file = output_path / output_name
                if not output_file.exists() or not output_file.stat().st_size:
                    detector_name = output_name.replace('computed_tracks', 'computed_detections')
                    detector_path = output_path / detector_name
                    if detector_path.exists() and detector_path.stat().st_size:
                        output_file = detector_path
                if frame_range is not None and camera_media[cam_name][1] == constants.VideoType:
                    filtered_path = filter_csv_by_frame_range(str(output_file), frame_range)
                    output_file = Path(filtered_path)
                newfile = gc.uploadFileToFolder(camera['folder_id'], str(output_file))
                gc.addMetadataToItem(str(newfile["itemId"]), {"pipeline": pipeline})
                gc.post(
                    f'dive_rpc/postprocess/{camera["folder_id"]}',
                    data={"skipJobs": True},
                )
            return

        # Download source media
        input_folder: GirderModel = gc.getFolder(input_folder_id)
        creates_new_dataset = pipeline_creates_new_dataset(pipeline)
        input_media_list, _ = utils.download_source_media(
            gc, input_folder_id, input_path, force_transcoded
        )

        if input_type == constants.VideoType:
            input_fps = fromMeta(input_folder, constants.FPSMarker)
            assert len(input_media_list) == 1, "Expected exactly 1 video"
            command = [
                f". {shlex.quote(str(conf.viame_setup_script))} &&",
                f"KWIVER_DEFAULT_LOG_LEVEL={shlex.quote(conf.kwiver_log_level)}",
                "viame runner",
                "-s input:video_reader:type=vidl_ffmpeg",
                f"-p {shlex.quote(str(pipeline_path))}",
                f"-s input:video_filename={shlex.quote(input_media_list[0])}",
                f"-s downsampler:target_frame_rate={shlex.quote(str(input_fps))}",
                f"-s detector_writer:file_name={shlex.quote(detector_output_file)}",
                f"-s track_writer:file_name={shlex.quote(track_output_file)}",
            ]
            if frame_range is not None:
                _append_frame_range_video_settings(
                    command, input_folder, frame_range, pipeline['pipe']
                )
        elif input_type == constants.ImageSequenceType:
            # Filter image list by frame range if specified
            filtered_media_list = input_media_list
            if frame_range is not None:
                filtered_media_list = filter_image_list_by_frame_range(
                    input_media_list, frame_range
                )
            with open(img_list_path, "w+") as img_list_file:
                img_list_file.write('\n'.join(filtered_media_list))
            command = [
                f". {shlex.quote(str(conf.viame_setup_script))} &&",
                f"KWIVER_DEFAULT_LOG_LEVEL={shlex.quote(conf.kwiver_log_level)}",
                "viame runner",
                f"-p {shlex.quote(str(pipeline_path))}",
                f"-s input:video_filename={shlex.quote(str(img_list_path))}",
                f"-s detector_writer:file_name={shlex.quote(detector_output_file)}",
                f"-s track_writer:file_name={shlex.quote(track_output_file)}",
            ]
        else:
            raise ValueError('Unknown input type: {}'.format(input_type))

        # Include input detections
        if input_revision is not None:
            pipeline_input_file = input_path / 'groundtruth.csv'
            utils.download_revision_csv(gc, input_folder_id, input_revision, pipeline_input_file)
            quoted_input_file = shlex.quote(str(pipeline_input_file))
            command.append(f'-s detection_reader:file_name={quoted_input_file}')
            command.append(f'-s track_reader:file_name={quoted_input_file}')

        transcoded_video = None
        if creates_new_dataset:
            video_name = None
            if is_transcode_pipeline(pipeline):
                video_name = str(
                    output_path / f"{pipeline.get('name', 'transcode')}_{input_folder_id}.mp4"
                )
            transcoded_video = append_new_dataset_media_writers(
                command, pipeline, output_path, video_filename=video_name
            )

        single_input_manifest = (
            str(img_list_path) if input_type == constants.ImageSequenceType else input_media_list[0]
        )
        _append_input_list_kwiver_settings(command, pipeline, [single_input_manifest])

        _inject_dataset_metadata_file(command, gc, _working_directory_path, params, manager)

        # Apply user-provided KWIVER parameter overrides.
        kwiver_params = params.get('kwiver_params')
        if kwiver_params:
            for key, value in kwiver_params.items():
                command.append(f'-s {shlex.quote(key)}={shlex.quote(str(value))}')

        manager.updateStatus(JobStatus.RUNNING)
        popen_kwargs = {
            'args': " ".join(command),
            'shell': True,
            'executable': '/bin/bash',
            'cwd': output_path,
            'env': conf.gpu_process_env,
        }
        utils.stream_subprocess(self, context, manager, popen_kwargs)

        if creates_new_dataset:
            manager.updateStatus(JobStatus.PUSHING_OUTPUT)
            _push_new_dataset_from_media(
                gc,
                manager,
                params,
                input_folder_id,
                output_path,
                pipeline,
                transcoded_video=transcoded_video,
            )
            return

        if Path(track_output_file).exists() and os.path.getsize(track_output_file):
            output_file = track_output_file
        else:
            output_file = detector_output_file

        # Filter output CSV by frame range for videos
        if frame_range is not None and input_type == constants.VideoType:
            output_file = filter_csv_by_frame_range(output_file, frame_range)

        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        newfile = gc.uploadFileToFolder(output_folder_id, output_file)

        gc.addMetadataToItem(str(newfile["itemId"]), {"pipeline": pipeline})
        gc.post(f'dive_rpc/postprocess/{output_folder_id}', data={"skipJobs": True})
