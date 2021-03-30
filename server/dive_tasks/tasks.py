import contextlib
import json
import os
import shlex
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from subprocess import Popen
from typing import Dict, List, Tuple
from urllib import request
from urllib.parse import urlparse

from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus
from GPUtil import getGPUs

from dive_tasks.pipeline_discovery import discover_configs
from dive_tasks.utils import (
    download_source_media,
    organize_folder_for_training,
    stream_subprocess,
)
from dive_utils import fromMeta
from dive_utils.constants import (
    DatasetMarker,
    TrainedPipelineCategory,
    TrainedPipelineMarker,
    TypeMarker,
    VideoType,
)
from dive_utils.types import AvailableJobSchema, GirderModel, PipelineJob

EMPTY_JOB_SCHEMA: AvailableJobSchema = {
    'pipelines': {},
    'training': {
        'configs': [],
        'default': None,
    },
}
UPGRADE_JOB_DEFAULT_URLS: List[str] = [
    'https://data.kitware.com/api/v1/item/6011e3452fa25629b91ade60/download',  # Habcam
    'https://viame.kitware.com/api/v1/item/604859fc5b1737bb9085f5e2/download',  # SEFSC
    'https://data.kitware.com/api/v1/item/6011ebf72fa25629b91aef03/download',  # PengHead
    'https://data.kitware.com/api/v1/item/601b00d02fa25629b9391ad6/download',  # Motion
    'https://data.kitware.com/api/v1/item/601afdde2fa25629b9390c41/download',  # EM Tuna
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

        self.viame_install_path = Path(self.viame_install_directory)
        assert self.viame_install_path.exists(), "VIAME Base install directory missing"
        self.viame_setup_script = self.viame_install_path / "setup_viame.sh"
        assert self.viame_setup_script.is_file(), "VIAME Setup Script missing"
        self.viame_training_executable = (
            self.viame_install_path / "bin" / "viame_train_detector"
        )
        assert (
            self.viame_training_executable.is_file()
        ), "VIAME Training Executable missing"

        # The subdirectory within VIAME_INSTALL_PATH where pipelines can be found
        self.pipeline_subdir = 'configs/pipelines'
        self.viame_pipeine_path = self.viame_install_path / self.pipeline_subdir
        assert self.viame_pipeine_path.exists(), "VIAME common pipe directory missing"

        self.addon_root_path = Path(self.addon_root_directory)
        self.addon_zip_path = self.addon_root_path / 'zips'
        self.addon_extracted_path = self.addon_root_path / 'extracted'

        self.addon_zip_path.mkdir(exist_ok=True, parents=True)
        self.addon_extracted_path.mkdir(exist_ok=True, parents=True)

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


@app.task(bind=True, acks_late=True)
def upgrade_pipelines(
    self: Task,
    urls: List[str] = UPGRADE_JOB_DEFAULT_URLS,
    force: bool = False,
):
    """ Install addons from zip files over HTTP """
    conf = Config()
    manager: JobManager = self.job_manager
    gc: GirderClient = self.girder_client
    # zipfiles to extract after download is complete
    addons_to_update_update: List[Path] = []

    for idx, addon in enumerate(urls):
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
        if self.canceled:
            manager.updateStatus(JobStatus.CANCELED)
            return JobStatus.CANCELED

    # remove and recreate the existing addon pipeline directory
    shutil.rmtree(conf.addon_extracted_path)
    # copy over data from built image, which causes mkdir() for all parents
    shutil.copytree(
        conf.viame_pipeine_path, conf.get_extracted_pipeline_path(missing_ok=True)
    )
    # Extract zipfiles over newly copied files.  Right now the zip archives
    # MUST contain the pipeline subdir (e.g. configs/pipelines) in their
    # internal structure.
    for zipfile_path in addons_to_update_update:
        manager.write(
            f'Extracting {zipfile_path} to {str(conf.addon_extracted_path)}\n'
        )
        z = zipfile.ZipFile(zipfile_path)
        z.extractall(conf.addon_extracted_path)

    if self.canceled:
        # Remove everything
        shutil.rmtree(conf.addon_extracted_path)
        manager.updateStatus(JobStatus.CANCELED)
        gc.post('viame/update_job_configs', json=EMPTY_JOB_SCHEMA)
        return JobStatus.CANCELED

    # finally, crawl the new files and report results
    summary = discover_configs(conf.get_extracted_pipeline_path())
    gc.post('viame/update_job_configs', json=summary)


@app.task(bind=True, acks_late=True)
def run_pipeline(self: Task, params: PipelineJob):
    conf = Config()
    manager: JobManager = self.job_manager
    gc: GirderClient = self.girder_client
    manager.updateStatus(JobStatus.FETCHING_INPUT)

    # Extract params
    pipeline = params["pipeline"]
    input_folder_id = params["input_folder"]
    input_type = params["input_type"]
    output_folder = params["output_folder"]
    pipeline_input = params["pipeline_input"]

    # Create temporary files/folders, removed at the end of the function
    input_path = Path(tempfile.mkdtemp())
    trained_pipeline_folder = Path(tempfile.mkdtemp())
    misc_path = Path(tempfile.mkdtemp())
    detector_output_path = (misc_path / 'detector_output.csv').name
    track_output_path = (misc_path / 'track_output.csv').name
    img_list_path = (misc_path / 'img_list_file.txt').name

    # defer cleanup
    def cleanup():
        shutil.rmtree(misc_path, ignore_errors=True)
        shutil.rmtree(input_path, ignore_errors=True)
        shutil.rmtree(trained_pipeline_folder, ignore_errors=True)

    if pipeline["type"] == TrainedPipelineCategory:
        gc.downloadFolderRecursive(pipeline["folderId"], str(trained_pipeline_folder))
        pipeline_path = trained_pipeline_folder / pipeline["pipe"]
    else:
        pipeline_path = conf.get_extracted_pipeline_path() / pipeline["pipe"]

    # Download source media
    input_folder = gc.getFolder(input_folder_id)
    input_media_list = download_source_media(gc, input_folder, input_path)

    if input_type == 'video':
        assert len(input_media_list) == 1, "Expected exactly 1 video"
        input_video_filename = str(input_path / input_media_list[0]['name'])
        command = [
            f". {shlex.quote(str(conf.viame_setup_script))} &&",
            "kwiver runner",
            "-s input:video_reader:type=vidl_ffmpeg",
            f"-p {shlex.quote(str(pipeline_path))}",
            f"-s input:video_filename={shlex.quote(input_video_filename)}",
            f"-s detector_writer:file_name={shlex.quote(detector_output_path)}",
            f"-s track_writer:file_name={shlex.quote(track_output_path)}",
        ]
    elif input_type == 'image-sequence':
        with open(img_list_path, "w+") as img_list_file:
            img_list_file.writelines(
                f"{str(input_path / item['name'])}\n" for item in input_media_list
            )
        command = [
            f". {shlex.quote(str(conf.viame_setup_script))} &&",
            "kwiver runner",
            f"-p {shlex.quote(str(pipeline_path))}",
            f"-s input:video_filename={shlex.quote(img_list_path)}",
            f"-s detector_writer:file_name={shlex.quote(detector_output_path)}",
            f"-s track_writer:file_name={shlex.quote(track_output_path)}",
        ]
    else:
        raise ValueError('Unknown input type: {}'.format(input_type))

    # Include input detections
    if pipeline_input is not None:
        pipeline_input_file = str(input_path / pipeline_input["name"])
        self.girder_client.downloadFile(str(pipeline_input["_id"]), pipeline_input_file)
        quoted_input_file = shlex.quote(pipeline_input_file)
        command.append(f'-s detection_reader:file_name={quoted_input_file}')
        command.append(f'-s track_reader:file_name={quoted_input_file}')

    cmd = " ".join(command)
    manager.write(f"Running command: {cmd}\n", forceFlush=True)
    manager.updateStatus(JobStatus.RUNNING)

    process_err_file = tempfile.TemporaryFile()
    process = Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=process_err_file,
        shell=True,
        executable='/bin/bash',
        env=conf.gpu_process_env,
    )
    stream_subprocess(process, self, manager, process_err_file, cleanup=cleanup)
    if self.canceled:
        return

    if os.path.getsize(track_output_path) > 0:
        output_path = track_output_path
    else:
        output_path = detector_output_path

    manager.updateStatus(JobStatus.PUSHING_OUTPUT)
    newfile = gc.uploadFileToFolder(output_folder, output_path)

    gc.addMetadataToItem(newfile["itemId"], {"pipeline": pipeline})
    gc.post(f'viame/postprocess/{output_folder}', data={"skipJobs": True})


@app.task(bind=True, acks_late=True)
def train_pipeline(
    self: Task,
    results_folder: GirderModel,
    source_folder_list: List[GirderModel],
    groundtruth_list: List[GirderModel],
    pipeline_name: str,
    config: str,
):
    """
    Train a pipeline by making a call to viame_train_detector

    :param results_folder: The Girder Folder to place the results of training into
    :param source_folder_list: The Girder Folders to pull training data from
    :param groundtruth_list: A list of relative paths to either a file containing detections,
        or a folder containing that file.
    :param pipeline_name: The base name of the resulting pipeline.
    :param config: string name of the input configuration
    """
    conf = Config()
    gc: GirderClient = self.girder_client
    manager: JobManager = self.job_manager

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
    with tempfile.TemporaryDirectory() as _temp_dir_string:
        manager.updateStatus(JobStatus.FETCHING_INPUT)
        root_data_dir = Path(_temp_dir_string)

        for index in range(len(source_folder_list)):
            source_folder = source_folder_list[index]
            groundtruth = groundtruth_list[index]
            download_path = Path(tempfile.mkdtemp(dir=root_data_dir))
            trained_on_list.append(str(source_folder["_id"]))
            # Download groundtruth item
            gc.downloadItem(str(groundtruth["_id"]), download_path)
            # Rename groundtruth csv file
            groundtruth_file = organize_folder_for_training(
                download_path, download_path / groundtruth["name"]
            )
            input_groundtruth_list.append((download_path, groundtruth_file))
            # Download input media
            input_media_list = download_source_media(gc, source_folder, download_path)
            if fromMeta(source_folder, TypeMarker) == VideoType:
                download_path = download_path / input_media_list[0]['name']

        input_folder_file_list = root_data_dir / "input_folder_list.txt"
        ground_truth_file_list = root_data_dir / "input_truth_list.txt"
        with open(input_folder_file_list, "w+") as data_list:
            with open(ground_truth_file_list, "w+") as truth_list:
                for folder_path, truthfile_path in input_groundtruth_list:
                    data_list.write(f"{folder_path}\n")
                    truth_list.write(f"{truthfile_path}\n")

        # Completely separate directory from `root_data_dir`
        with tempfile.TemporaryDirectory() as _training_output_path:
            training_output_path = Path(_training_output_path)
            command = [
                f". {shlex.quote(str(conf.viame_setup_script))} &&",
                shlex.quote(str(conf.viame_training_executable)),
                "-il",
                shlex.quote(str(input_folder_file_list)),
                "-it",
                shlex.quote(str(ground_truth_file_list)),
                "-c",
                shlex.quote(str(config_file)),
                "--no-query",
            ]

            manager.updateStatus(JobStatus.RUNNING)
            cmd = " ".join(command)
            manager.write(f"Running command: {cmd}\n", forceFlush=True)

            process_err_file = tempfile.TemporaryFile()
            process = Popen(
                " ".join(command),
                stdout=subprocess.PIPE,
                stderr=process_err_file,
                shell=True,
                executable='/bin/bash',
                cwd=training_output_path,
                env=conf.gpu_process_env,
            )
            stream_subprocess(process, self, manager, process_err_file)
            if self.canceled:
                return

            training_results_path = training_output_path / "category_models"

            # Check that there are results in the output path
            if len(list(training_results_path.glob("*"))) == 0:
                raise RuntimeError(
                    "Training output didn't produce results, discarding..."
                )

            manager.updateStatus(JobStatus.PUSHING_OUTPUT)
            # This is the name of the folder that is uploaded to the
            # "Training Results" girder folder
            girder_output_folder = gc.createFolder(
                results_folder["_id"],
                pipeline_name,
                metadata={
                    TrainedPipelineMarker: True,
                    "trained_on": trained_on_list,
                },
            )
            gc.upload(f"{training_results_path}/*", girder_output_folder["_id"])


@app.task(bind=True, acks_late=True)
def convert_video(self: Task, path, folderId, auxiliaryFolderId, itemId):
    # Delete is true, so the tempfile is deleted when the block closes.
    # We are only using this to get a name, and recreating it below.
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=True) as temp:
        output_path = temp.name

    def cleanup():
        with contextlib.suppress(FileNotFoundError):
            os.remove(output_path)

    gc: GirderClient = self.girder_client
    manager: JobManager = self.job_manager

    # Extract metadata
    file_name = os.path.join(path, os.listdir(path)[0])
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

    process_err_file = tempfile.TemporaryFile()
    process = Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=process_err_file,
    )
    stdout = stream_subprocess(
        process, self, manager, process_err_file, keep_stdout=True
    )
    if self.canceled:
        return

    jsoninfo = json.loads(stdout)
    videostream = list(
        filter(lambda x: x["codec_type"] == "video", jsoninfo["streams"])
    )
    if len(videostream) != 1:
        raise Exception('Expected 1 video stream, found {}'.format(len(videostream)))

    process_err_file = tempfile.TemporaryFile()
    process = Popen(
        [
            "ffmpeg",
            "-i",
            file_name,
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "26",
            # https://askubuntu.com/questions/1315697/could-not-find-tag-for-codec-pcm-s16le-in-stream-1-codec-not-currently-support
            "-c:a",
            "aac",
            # see native/<platform> code for a discussion of this option
            "-vf",
            "scale=ceil(iw*sar/2)*2:ceil(ih/2)*2,setsar=1",
            output_path,
        ],
        stdout=subprocess.PIPE,
        stderr=process_err_file,
    )

    stream_subprocess(process, self, manager, process_err_file, cleanup=cleanup)
    if self.canceled:
        return

    manager.updateStatus(JobStatus.PUSHING_OUTPUT)
    new_file = gc.uploadFileToFolder(folderId, output_path)
    gc.addMetadataToItem(
        new_file['itemId'],
        {
            "source_video": False,
            "transcoder": "ffmpeg",
            "codec": "h264",
        },
    )
    gc.addMetadataToItem(
        itemId,
        {
            "source_video": True,
            "codec": videostream[0]["codec_name"],
        },
    )
    gc.addMetadataToFolder(
        folderId,
        {
            "fps": 5,  # TODO: current time system doesn't allow for non-int framerates
            DatasetMarker: True,  # mark the parent folder as able to annotate.
            "ffprobe_info": videostream[0],
        },
    )
    cleanup()


@app.task(bind=True, acks_late=True)
def convert_images(self: Task, folderId):
    """
    Ensures that all images in a folder are in a web friendly format (png or jpeg).

    If conversions succeeds for an image, it will replace the image with an image
    of the same name, but in a web friendly extension.

    Returns the number of images successfully converted.
    """
    gc: GirderClient = self.girder_client
    manager: JobManager = self.job_manager

    items = gc.listItem(folderId)
    skip_item = (
        lambda item: item["name"].endswith(".png")
        or item["name"].endswith(".jpeg")
        or item["name"].endswith(".jpg")
    )
    items_to_convert = [item for item in items if not skip_item(item)]

    count = 0
    with tempfile.TemporaryDirectory() as temp:
        dest_dir = Path(temp)

        for item in items_to_convert:
            # Assumes 1 file per item
            gc.downloadItem(item["_id"], dest_dir, item["name"])

            item_path = dest_dir / item["name"]
            new_item_path = dest_dir / ".".join([*item["name"].split(".")[:-1], "png"])

            process_err_file = tempfile.TemporaryFile()
            process = Popen(
                ["ffmpeg", "-i", item_path, new_item_path],
                stdout=subprocess.PIPE,
                stderr=process_err_file,
            )
            stream_subprocess(process, self, manager, process_err_file)
            if self.canceled:
                return

            gc.uploadFileToFolder(folderId, new_item_path)
            gc.delete(f"item/{item['_id']}")
            count += 1

    gc.addMetadataToFolder(
        str(folderId),
        {"annotate": True},  # mark the parent folder as able to annotate.
    )

    return count
