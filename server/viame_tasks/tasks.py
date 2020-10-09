import json
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from subprocess import DEVNULL, Popen
from typing import Dict, List

from girder_worker.app import app
from GPUtil import getGPUs

from viame_tasks.utils import (
  organize_folder_for_training,
  read_and_close_process_outputs,
)
from viame_tasks.utils import trained_pipeline_folder as _trained_pipeline_folder


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

        self.pipeline_base_path = os.environ.get(
            'VIAME_PIPELINES_PATH', '/opt/noaa/viame/configs/pipelines/'
        )
        self.viame_install_path = os.environ.get(
            'VIAME_INSTALL_PATH', '/opt/noaa/viame'
        )


@app.task(bind=True)
def run_pipeline(self, input_path, output_folder, pipeline, input_type):
    conf = Config()

    # Delete is false because the file needs to exist for kwiver to write to
    # removed at the bottom of the function
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as temp:
        detector_output_path = temp.name
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as temp:
        track_output_path = temp.name

    # get a list of the input media
    # TODO: better filtering that only allows files of valid types
    directory_files = os.listdir(input_path)
    filtered_directory_files = []
    for file_name in directory_files:
        full_file_path = os.path.join(input_path, file_name)
        is_directory = os.path.isdir(full_file_path)
        if (not is_directory) and (
            not os.path.splitext(file_name)[1].lower() == '.csv'
        ):
            filtered_directory_files.append(file_name)

    if len(filtered_directory_files) == 0:
        raise ValueError('No media files found in {}'.format(input_path))

    # Handle spaces in pipeline names
    pipeline = pipeline.replace(" ", r"\ ")

    # Handle trained pipelines
    trained_pipeline_folder = _trained_pipeline_folder()
    if pipeline.startswith("trained_") and trained_pipeline_folder:
        pipeline_path = os.path.join(trained_pipeline_folder, pipeline, "detector.pipe")
    else:
        pipeline_path = os.path.join(conf.pipeline_base_path, pipeline)

    if input_type == 'video':
        input_file = os.path.join(input_path, filtered_directory_files[0])
        command = [
            f"cd {conf.viame_install_path} &&",
            ". ./setup_viame.sh &&",
            "kwiver runner",
            "-s input:video_reader:type=vidl_ffmpeg",
            f"-p {pipeline_path}",
            f"-s input:video_filename={input_file}",
            f"-s detector_writer:file_name={detector_output_path}",
            f"-s track_writer:file_name={track_output_path}",
        ]
    elif input_type == 'image-sequence':
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as temp2:
            temp2.writelines(
                (
                    (os.path.join(input_path, file_name) + "\n").encode()
                    for file_name in sorted(filtered_directory_files)
                )
            )
            image_list_file = temp2.name
        command = [
            f"cd {conf.viame_install_path} &&",
            ". ./setup_viame.sh &&",
            "kwiver runner",
            f"-p {pipeline_path}",
            f"-s input:video_filename={image_list_file}",
            f"-s detector_writer:file_name={detector_output_path}",
            f"-s track_writer:file_name={track_output_path}",
        ]
    else:
        raise ValueError('Unknown input type: {}'.format(input_type))

    cmd = " ".join(command)
    print('Running command:', cmd)

    process_log_file = tempfile.TemporaryFile()
    process_err_file = tempfile.TemporaryFile()

    process = Popen(
        cmd,
        stderr=process_err_file,
        stdout=process_log_file,
        shell=True,
        executable='/bin/bash',
        env=conf.gpu_process_env,
    )

    stdout, stderr = read_and_close_process_outputs(
        process, process_log_file, process_err_file
    )
    if process.returncode > 0:
        raise RuntimeError(
            'Pipeline exited with nonzero status code {}: {}'.format(
                process.returncode, stderr
            )
        )
    else:
        self.job_manager.write(stdout + "\n" + stderr)

    if os.path.getsize(track_output_path) > 0:
        output_path = track_output_path
    else:
        output_path = detector_output_path

    newfile = self.girder_client.uploadFileToFolder(output_folder, output_path)

    self.girder_client.addMetadataToItem(newfile["itemId"], {"pipeline": pipeline})
    self.girder_client.post(
        f'viame/postprocess/{output_folder}', data={"skipJobs": True}
    )
    os.remove(track_output_path)
    os.remove(detector_output_path)


@app.task(bind=True)
def train_pipeline(
    self,
    results_folder: Dict,
    training_data: List[Dict],
    groundtruth: Dict,
    pipeline_name: str,
    config: str,
):
    """
    Train a pipeline by making a call to viame_train_detector

    :param source_folder: The Girder Folder to pull training data from
    :param results_folder: The Girder Folder to place the results of training into
    :param groundtruth: The relative path to either the file containing detections,
        or the folder containing that file.
    :param pipeline_name: The base name of the resulting pipeline.
    """
    conf = Config()
    gc = self.girder_client

    viame_install_path = Path(conf.viame_install_path)
    pipeline_base_path = Path(conf.pipeline_base_path)
    training_executable = viame_install_path / "bin" / "viame_train_detector"
    config_file = pipeline_base_path / config

    pipeline_name = pipeline_name.replace(" ", "_")

    # root_data_dir is the directory passed to `viame_train_detector`
    with tempfile.TemporaryDirectory() as _temp_dir_string:
        root_data_dir = Path(_temp_dir_string)
        download_path = Path(tempfile.mkdtemp(dir=root_data_dir))

        # Download data onto server
        gc.downloadItem(str(groundtruth["_id"]), download_path)
        for item in training_data:
            gc.downloadItem(str(item["_id"]), download_path)

        # Organize data
        groundtruth_path = download_path / groundtruth["name"]
        organize_folder_for_training(root_data_dir, download_path, groundtruth_path)

        # Completely separate directory from `root_data_dir`
        with tempfile.TemporaryDirectory() as _training_output_path:
            training_output_path = Path(_training_output_path)
            command = [
                f". {conf.viame_install_path}/setup_viame.sh &&",
                str(training_executable),
                "-i",
                str(root_data_dir),
                "-c",
                str(config_file),
            ]

            process_log_file = tempfile.TemporaryFile()
            process_err_file = tempfile.TemporaryFile()

            # Call viame_train_detector
            process = Popen(
                " ".join(command),
                stdout=process_log_file,
                stderr=process_err_file,
                shell=True,
                executable='/bin/bash',
                cwd=training_output_path,
                env=conf.gpu_process_env,
            )

            stdout, stderr = read_and_close_process_outputs(
                process, process_log_file, process_err_file
            )
            self.job_manager.write(stdout + "\n" + stderr)

            training_results_path = training_output_path / "category_models"

            # Get all files/folders in directory
            training_output = list(training_results_path.glob("*"))
            if process.returncode or not training_output:
                self.job_manager.write(
                    "Training output failed or didn't produce results, discarding..."
                )
                return

            timestamp = datetime.utcnow().replace(microsecond=0).isoformat()

            # This is the name of the folder that is uploaded to the
            # "Training Results" girder folder
            girder_output_folder_name = f"{pipeline_name} {timestamp}"
            girder_output_folder = training_output_path / girder_output_folder_name

            # Trained_ prefix is added to conform with existing pipeline names
            # This is the name that will appear in the client (with trained_ removed)
            trained_model_folder_name = f"trained_{pipeline_name}"
            named_training_output = training_output_path / trained_model_folder_name

            # Move the original folder to our new folder
            shutil.move(str(training_results_path), named_training_output)

            # If `_trained_pipeline_folder()` returns `None`, the results of this
            # training job will be uploaded to Girder, but will not be runnable as
            # a normal pipeline through the client
            trained_pipeline_folder = _trained_pipeline_folder()
            if trained_pipeline_folder:
                shutil.copytree(
                    named_training_output,
                    trained_pipeline_folder / trained_model_folder_name,
                )

            # Rename this folder so that it appears properly in girder
            shutil.move(str(named_training_output), girder_output_folder)
            self.girder_client._uploadFolderRecursive(
                girder_output_folder, results_folder["_id"], "folder"
            )


@app.task(bind=True)
def convert_video(self, path, folderId, auxiliaryFolderId):
    # Delete is true, so the tempfile is deleted when the block closes.
    # We are only using this to get a name, and recreating it below.
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=True) as temp:
        output_path = temp.name

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

    with tempfile.TemporaryFile() as process_log_file:
        process = Popen(command, stderr=DEVNULL, stdout=process_log_file)
        stdout, _ = read_and_close_process_outputs(process, process_log_file)

        jsoninfo = json.loads(stdout)
        videostream = list(
            filter(lambda x: x["codec_type"] == "video", jsoninfo["streams"])
        )
        if len(videostream) != 1:
            raise Exception(
                'Expected 1 video stream, found {}'.format(len(videostream))
            )

    process_log_file = tempfile.TemporaryFile()
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
            "-c:a",
            "copy",
            output_path,
        ],
        stdout=process_log_file,
        stderr=process_err_file,
    )

    stdout, stderr = read_and_close_process_outputs(
        process, process_log_file, process_err_file
    )

    output = stdout + "\n" + stderr
    self.job_manager.write(output)
    new_file = self.girder_client.uploadFileToFolder(folderId, output_path)
    self.girder_client.addMetadataToItem(new_file['itemId'], {"codec": "h264"})
    self.girder_client.addMetadataToFolder(
        folderId,
        {
            "fps": 5,  # TODO: current time system doesn't allow for non-int framerates
            "annotate": True,  # mark the parent folder as able to annotate.
            "ffprobe_info": videostream[0],
        },
    )
    os.remove(output_path)


@app.task(bind=True)
def convert_images(self, folderId):
    """
    Ensures that all images in a folder are in a web friendly format (png or jpeg).

    If conversions succeeds for an image, it will replace the image with an image
    of the same name, but in a web friendly extension.

    Returns the number of images successfully converted.
    """
    gc = self.girder_client

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

            process_log_file = tempfile.TemporaryFile()
            process_err_file = tempfile.TemporaryFile()
            process = Popen(
                ["ffmpeg", "-i", item_path, new_item_path],
                stdout=process_log_file,
                stderr=process_err_file,
            )

            stdout, stderr = read_and_close_process_outputs(
                process, process_log_file, process_err_file
            )

            output = ""
            if len(stdout):
                output = f"{stdout}\n"
            if len(stderr):
                output = f"{output}{stderr}\n"

            self.job_manager.write(output)

            if process.returncode == 0:
                gc.uploadFileToFolder(folderId, new_item_path)
                gc.delete(f"item/{item['_id']}")
                count += 1

    self.girder_client.addMetadataToFolder(
        str(folderId),
        {"annotate": True},  # mark the parent folder as able to annotate.
    )

    return count
