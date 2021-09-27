from contextlib import suppress
import json
import os
from pathlib import Path
import shlex
import shutil
import tempfile
from typing import Dict, List, Tuple
from urllib import request
from urllib.parse import urlparse
import zipfile

from GPUtil import getGPUs
from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_tasks import utils
from dive_tasks.frame_alignment import check_and_fix_frame_alignment
from dive_tasks.manager import patch_manager
from dive_tasks.pipeline_discovery import discover_configs
from dive_utils import constants, fromMeta
from dive_utils.types import AvailableJobSchema, GirderModel, PipelineJob

EMPTY_JOB_SCHEMA: AvailableJobSchema = {
    'pipelines': {},
    'training': {
        'configs': [],
        'default': None,
    },
}

# https://github.com/VIAME/VIAME/blob/master/cmake/download_viame_addons.sh
UPGRADE_JOB_DEFAULT_URLS: List[str] = [
    'https://viame.kitware.com/api/v1/item/60d3c198b91def413908961a/download',  # Habcam
    'https://viame.kitware.com/api/v1/item/60b3a58b8438b3b7ffd7032f/download',  # SEFSC
    'https://data.kitware.com/api/v1/item/6011ebf72fa25629b91aef03/download',  # PengHead
    'https://data.kitware.com/api/v1/item/601b00d02fa25629b9391ad6/download',  # Motion
    'https://data.kitware.com/api/v1/item/601afdde2fa25629b9390c41/download',  # EM Tuna
    'https://viame.kitware.com/api/v1/item/61494377a020b1e852638431/download',  # MOUSS Deep 7
]


def get_gpu_environment() -> Dict[str, str]:
    """Get environment variables for using CUDA enabled GPUs."""
    env = os.environ.copy()

    gpu_uuid = env.get("WORKER_GPU_UUID")
    gpus = [gpu.id for gpu in getGPUs() if gpu.uuid == gpu_uuid]

    # Only set this env var if WORKER_GPU_UUID was supplied,
    # and it matches an installed GPU
    if gpus:
        env["CUDA_VISIBLE_DEVICES"] = str(gpus[0])

    return env


class Config:
    def __init__(self):
        self.gpu_process_env = get_gpu_environment()
        self.viame_install_directory = os.environ.get(
            'VIAME_INSTALL_PATH',
            '/opt/noaa/viame',
        )
        self.addon_root_directory = os.environ.get(
            'ADDON_ROOT_DIR',
            '/tmp/addons',
        )
        self.kwiver_log_level = os.environ.get(
            'KWIVER_DEFAULT_LOG_LEVEL',
            'warn',
        )

        self.viame_install_path = Path(self.viame_install_directory)
        assert self.viame_install_path.exists(), "VIAME Base install directory missing."
        self.viame_setup_script = self.viame_install_path / "setup_viame.sh"
        assert self.viame_setup_script.is_file(), "VIAME Setup Script missing"
        self.viame_training_executable = self.viame_install_path / "bin" / "viame_train_detector"
        assert self.viame_training_executable.is_file(), "VIAME Training Executable missing"

        # The subdirectory within VIAME_INSTALL_PATH where pipelines can be found
        self.pipeline_subdir = 'configs/pipelines'
        self.viame_pipeine_path = self.viame_install_path / self.pipeline_subdir
        assert self.viame_pipeine_path.exists(), "VIAME common pipe directory missing."

        self.addon_root_path = Path(self.addon_root_directory)
        self.addon_zip_path = utils.make_directory(self.addon_root_path / 'zips')
        self.addon_extracted_path = utils.make_directory(self.addon_root_path / 'extracted')

        # Set include directory to include pipelines from this path
        # https://github.com/VIAME/VIAME/issues/131
        self.gpu_process_env['SPROKIT_PIPE_INCLUDE_PATH'] = str(
            self.addon_extracted_path / self.pipeline_subdir
        )

    def get_extracted_pipeline_path(self, missing_ok=False) -> Path:
        """
        Includes subdirectory for pipelines
        """
        pipeline_path = self.addon_extracted_path / self.pipeline_subdir
        if not missing_ok:
            assert pipeline_path.exists(), f"Missing path {pipeline_path}"
        return pipeline_path


@app.task(bind=True, acks_late=True, ignore_result=True)
def upgrade_pipelines(
    self: Task,
    urls: List[str] = UPGRADE_JOB_DEFAULT_URLS,
    force: bool = False,
):
    """Install addons from zip files over HTTP"""
    conf = Config()
    context: dict = {}
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    gc: GirderClient = self.girder_client
    # zipfiles to extract after download is complete
    addons_to_update_update: List[Path] = []

    for addon in urls:
        download_name = urlparse(addon).path.replace('/', '_')
        zipfile_path = conf.addon_zip_path / f'{download_name}.zip'
        if not zipfile_path.exists() or force:
            # Update the zipfile if force option set or file not exists
            manager.write(f'Downloading {addon} to {zipfile_path}\n')
            # TODO wrap try catch
            request.urlretrieve(addon, filename=zipfile_path)
        else:
            manager.write(f'Skipping download of {zipfile_path}\n')
        addons_to_update_update.append(zipfile_path)
        if utils.check_canceled(self, context, force=False):
            manager.updateStatus(JobStatus.CANCELED)
            return

    # remove and recreate the existing addon pipeline directory
    shutil.rmtree(conf.addon_extracted_path)
    # copy over data from built image, which causes mkdir() for all parents
    shutil.copytree(conf.viame_pipeine_path, conf.get_extracted_pipeline_path(missing_ok=True))
    # Extract zipfiles over newly copied files.  Right now the zip archives
    # MUST contain the pipeline subdir (e.g. configs/pipelines) in their
    # internal structure.
    for zipfile_path in addons_to_update_update:
        manager.write(f'Extracting {zipfile_path} to {str(conf.addon_extracted_path)}\n')
        z = zipfile.ZipFile(zipfile_path)
        z.extractall(conf.addon_extracted_path)

    if utils.check_canceled(self, context):
        # Remove everything
        shutil.rmtree(conf.addon_extracted_path)
        manager.updateStatus(JobStatus.CANCELED)
        gc.put('dive_configuration/static_pipeline_configs', json=EMPTY_JOB_SCHEMA)
        return

    # finally, crawl the new files and report results
    summary = discover_configs(conf.get_extracted_pipeline_path())
    gc.put('dive_configuration/static_pipeline_configs', json=summary)


@app.task(bind=True, acks_late=True, ignore_result=True)
def run_pipeline(self: Task, params: PipelineJob):
    conf = Config()
    context: dict = {}
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    gc: GirderClient = self.girder_client
    manager.updateStatus(JobStatus.FETCHING_INPUT)

    # Extract params
    pipeline = params["pipeline"]
    input_folder_id = str(params["input_folder"])
    input_type = params["input_type"]
    output_folder_id = str(params["output_folder"])
    pipeline_input = params["pipeline_input"]

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        _working_directory_path = Path(_working_directory)
        input_path = utils.make_directory(_working_directory_path / 'input')
        trained_pipeline_path = utils.make_directory(_working_directory_path / 'trained_pipeline')
        output_path = utils.make_directory(_working_directory_path / 'output')

        detector_output_file = str(output_path / 'detector_output.csv')
        track_output_file = str(output_path / 'track_output.csv')
        img_list_path = input_path / 'img_list_file.txt'

        if pipeline["type"] == constants.TrainedPipelineCategory:
            gc.downloadFolderRecursive(pipeline["folderId"], str(trained_pipeline_path))
            pipeline_path = trained_pipeline_path / pipeline["pipe"]
        else:
            pipeline_path = conf.get_extracted_pipeline_path() / pipeline["pipe"]

        assert pipeline_path.exists(), (
            "Requested pipeline could not be found."
            " Make sure that VIAME is installed correctly and all addons have loaded."
            f" Job asked for {pipeline_path} but it does not exist"
        )

        # Download source media
        input_folder: GirderModel = gc.getFolder(input_folder_id)
        input_media_list = utils.download_source_media(gc, input_folder_id, input_path)

        if input_type == constants.VideoType:
            input_fps = fromMeta(input_folder, constants.FPSMarker)
            assert len(input_media_list) == 1, "Expected exactly 1 video"
            command = [
                f". {shlex.quote(str(conf.viame_setup_script))} &&",
                f"KWIVER_DEFAULT_LOG_LEVEL={shlex.quote(conf.kwiver_log_level)}",
                "kwiver runner",
                "-s input:video_reader:type=vidl_ffmpeg",
                f"-p {shlex.quote(str(pipeline_path))}",
                f"-s input:video_filename={shlex.quote(input_media_list[0])}",
                f"-s downsampler:target_frame_rate={shlex.quote(str(input_fps))}",
                f"-s detector_writer:file_name={shlex.quote(detector_output_file)}",
                f"-s track_writer:file_name={shlex.quote(track_output_file)}",
            ]
        elif input_type == constants.ImageSequenceType:
            with open(img_list_path, "w+") as img_list_file:
                img_list_file.write('\n'.join(input_media_list))
            command = [
                f". {shlex.quote(str(conf.viame_setup_script))} &&",
                f"KWIVER_DEFAULT_LOG_LEVEL={shlex.quote(conf.kwiver_log_level)}",
                "kwiver runner",
                f"-p {shlex.quote(str(pipeline_path))}",
                f"-s input:video_filename={shlex.quote(str(img_list_path))}",
                f"-s detector_writer:file_name={shlex.quote(detector_output_file)}",
                f"-s track_writer:file_name={shlex.quote(track_output_file)}",
            ]
        else:
            raise ValueError('Unknown input type: {}'.format(input_type))

        # Include input detections
        if pipeline_input is not None:
            pipeline_input_id = str(pipeline_input['_id'])
            pipeline_input_file = str(input_path / pipeline_input["name"])
            self.girder_client.downloadFile(pipeline_input_id, pipeline_input_file)
            quoted_input_file = shlex.quote(pipeline_input_file)
            command.append(f'-s detection_reader:file_name={quoted_input_file}')
            command.append(f'-s track_reader:file_name={quoted_input_file}')

        manager.updateStatus(JobStatus.RUNNING)
        popen_kwargs = {
            'args': " ".join(command),
            'shell': True,
            'executable': '/bin/bash',
            'cwd': output_path,
            'env': conf.gpu_process_env,
        }
        utils.stream_subprocess(self, context, manager, popen_kwargs)

        if Path(track_output_file).exists() and os.path.getsize(track_output_file):
            output_file = track_output_file
        else:
            output_file = detector_output_file

        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        newfile = gc.uploadFileToFolder(output_folder_id, output_file)

        gc.addMetadataToItem(str(newfile["itemId"]), {"pipeline": pipeline})
        gc.post(f'dive_rpc/postprocess/{output_folder_id}', data={"skipJobs": True})


@app.task(bind=True, acks_late=True, ignore_result=True)
def train_pipeline(
    self: Task,
    results_folder: GirderModel,
    source_folder_list: List[GirderModel],
    groundtruth_list: List[GirderModel],
    pipeline_name: str,
    config: str,
    annotated_frames_only: bool = False,
):
    """
    Train a pipeline by making a call to viame_train_detector

    :param results_folder: The Girder Folder to place the results of training into
    :param source_folder_list: The Girder Folders to pull training data from
    :param groundtruth_list: A list of relative paths to either a file containing detections,
        or a folder containing that file.
    :param pipeline_name: The base name of the resulting pipeline.
    :param config: string name of the input configuration
    :param annotated_frames_only: Only use annotated frames for training
    """
    conf = Config()
    context: dict = {}
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    gc: GirderClient = self.girder_client
    manager.updateStatus(JobStatus.FETCHING_INPUT)

    pipeline_base_path = Path(conf.get_extracted_pipeline_path())
    config_file = pipeline_base_path / config

    pipeline_name = pipeline_name.replace(" ", "_")

    if len(source_folder_list) != len(groundtruth_list):
        raise Exception("Ground truth doesn't exist for all folders")

    # List of folderIds used for training
    trained_on_list: List[str] = []
    # List of[input folder / ground truth file] pairs for creating input lists
    input_groundtruth_list: List[Tuple[Path, Path]] = []
    # root_data_dir is the directory passed to `viame_train_detector`
    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        _working_directory_path = Path(_working_directory)
        input_path = utils.make_directory(_working_directory_path / 'input')
        output_path = utils.make_directory(_working_directory_path / 'output')

        for index in range(len(source_folder_list)):
            source_folder = source_folder_list[index]
            groundtruth = groundtruth_list[index]
            download_path = input_path / source_folder['name']
            trained_on_list.append(str(source_folder["_id"]))
            # Download groundtruth item
            gc.downloadItem(str(groundtruth["_id"]), download_path)
            # Rename groundtruth csv file
            groundtruth_path = utils.organize_folder_for_training(
                download_path, download_path / groundtruth["name"]
            )
            # Download input media
            input_media_list = utils.download_source_media(
                gc, str(source_folder["_id"]), download_path
            )
            if fromMeta(source_folder, constants.TypeMarker) == constants.VideoType:
                download_path = Path(input_media_list[0])
            # Set media source location
            input_groundtruth_list.append((download_path, groundtruth_path))

        input_folder_file_list = input_path / "input_folder_list.txt"
        ground_truth_file_list = input_path / "input_truth_list.txt"
        with open(input_folder_file_list, "w+") as data_list:
            with open(ground_truth_file_list, "w+") as truth_list:
                for folder_path, groundtruth_path in input_groundtruth_list:
                    data_list.write(f"{folder_path}\n")
                    truth_list.write(f"{groundtruth_path}\n")

        training_results_path = utils.make_directory(output_path / "category_models")

        command = [
            f". {shlex.quote(str(conf.viame_setup_script))} &&",
            f"KWIVER_DEFAULT_LOG_LEVEL={shlex.quote(conf.kwiver_log_level)}",
            shlex.quote(str(conf.viame_training_executable)),
            "--input-list",
            shlex.quote(str(input_folder_file_list)),
            "--input-truth",
            shlex.quote(str(ground_truth_file_list)),
            "--config",
            shlex.quote(str(config_file)),
            "--no-query",
            "--no-embedded-pipe",
        ]

        if annotated_frames_only:
            command.append("--gt-frames-only")

        manager.updateStatus(JobStatus.RUNNING)
        popen_kwargs = {
            'args': " ".join(command),
            'shell': True,
            'executable': '/bin/bash',
            'cwd': output_path,
            'env': conf.gpu_process_env,
        }
        utils.stream_subprocess(self, context, manager, popen_kwargs)

        # Check that there are results in the output path
        if len(list(training_results_path.glob("*"))) == 0:
            raise RuntimeError("Training output didn't produce results, discarding...")

        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        # This is the name of the folder that is uploaded to the
        # "Training Results" girder folder
        girder_output_folder = gc.createFolder(
            results_folder["_id"],
            pipeline_name,
            metadata={
                constants.TrainedPipelineMarker: True,
                "trained_on": trained_on_list,
            },
        )
        gc.upload(f"{training_results_path}/*", girder_output_folder["_id"])


@app.task(bind=True, acks_late=True, ignore_result=True)
def convert_video(self: Task, folderId: str, itemId: str):
    context: dict = {}
    gc: GirderClient = self.girder_client
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    folderData = gc.getFolder(folderId)
    requestedFps = fromMeta(folderData, constants.FPSMarker)

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        _working_directory_path = Path(_working_directory)
        item: GirderModel = gc.getItem(itemId)
        file_name = str(_working_directory_path / item['name'])
        output_file_path = (_working_directory_path / item['name']).with_suffix('.transcoded.mp4')
        manager.write(f'Fetching input from {itemId} to {file_name}...\n')
        gc.downloadItem(itemId, _working_directory_path, name=item.get('name'))

        command = [
            "ffprobe",
            "-print_format",
            "json",
            "-v",
            "quiet",
            "-show_format",
            "-show_streams",
            file_name,
        ]
        stdout = utils.stream_subprocess(
            self, context, manager, {'args': command}, keep_stdout=True
        )
        jsoninfo = json.loads(stdout)
        videostream = list(filter(lambda x: x["codec_type"] == "video", jsoninfo["streams"]))
        if len(videostream) != 1:
            raise Exception('Expected 1 video stream, found {}'.format(len(videostream)))

        # Extract average framerate
        avgFpsString: str = videostream[0]["avg_frame_rate"]
        originalFps = None
        if avgFpsString:
            dividend, divisor = [int(v) for v in avgFpsString.split('/')]
            originalFps = dividend / divisor
        else:
            raise Exception('Expected key avg_frame_rate in ffprobe')

        if requestedFps == -1:
            newAnnotationFps = originalFps
        else:
            newAnnotationFps = min(requestedFps, originalFps)
        if newAnnotationFps < 1:
            raise Exception('FPS lower than 1 is not supported')

        command = [
            "ffmpeg",
            "-i",
            file_name,
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            # https://github.com/Kitware/dive/issues/855
            "-crf",
            "22",
            # https://askubuntu.com/questions/1315697/could-not-find-tag-for-codec-pcm-s16le-in-stream-1-codec-not-currently-support
            "-c:a",
            "aac",
            # see native/<platform> code for a discussion of this option
            "-vf",
            "scale=ceil(iw*sar/2)*2:ceil(ih/2)*2,setsar=1",
            str(output_file_path),
        ]
        utils.stream_subprocess(self, context, manager, {'args': command})
        # Check to see if frame alignment remains the same
        aligned_file = check_and_fix_frame_alignment(self, output_file_path, context, manager)

        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        new_file = gc.uploadFileToFolder(folderId, aligned_file)
        gc.addMetadataToItem(
            new_file['itemId'],
            {
                "source_video": False,
                "transcoder": "ffmpeg",
                constants.OriginalFPSMarker: originalFps,
                constants.OriginalFPSStringMarker: avgFpsString,
                "codec": "h264",
            },
        )
        gc.addMetadataToItem(
            itemId,
            {
                "source_video": True,
                constants.OriginalFPSMarker: originalFps,
                constants.OriginalFPSStringMarker: avgFpsString,
                "codec": videostream[0]["codec_name"],
            },
        )
        gc.addMetadataToFolder(
            folderId,
            {
                constants.DatasetMarker: True,  # mark the parent folder as able to annotate.
                constants.OriginalFPSMarker: originalFps,
                constants.OriginalFPSStringMarker: avgFpsString,
                constants.FPSMarker: newAnnotationFps,
                "ffprobe_info": videostream[0],
            },
        )


@app.task(bind=True, acks_late=True)
def convert_images(self: Task, folderId):
    """
    Ensures that all images in a folder are in a web friendly format (png or jpeg).

    If conversions succeeds for an image, it will replace the image with an image
    of the same name, but in a web friendly extension.

    Returns the number of images successfully converted.
    """
    context: dict = {}
    gc: GirderClient = self.girder_client
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    items_to_convert = [
        item
        for item in gc.listItem(folderId)
        if (
            constants.imageRegex.search(item["name"])
            and not constants.safeImageRegex.search(item["name"])
        )
    ]

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        working_directory_path = Path(_working_directory)
        images_path = utils.make_directory(working_directory_path / 'images')

        for item in items_to_convert:
            # Assumes 1 file per item
            gc.downloadItem(item["_id"], images_path, item["name"])

            item_path = images_path / item["name"]
            new_item_path = images_path / ".".join([*item["name"].split(".")[:-1], "png"])
            command = ["ffmpeg", "-i", str(item_path), str(new_item_path)]
            utils.stream_subprocess(self, context, manager, {'args': command})
            gc.uploadFileToFolder(folderId, new_item_path)
            gc.delete(f"item/{item['_id']}")

        gc.addMetadataToFolder(
            str(folderId),
            {"annotate": True},  # mark the parent folder as able to annotate.
        )
