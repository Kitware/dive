import json
import os
import re
import tempfile
from subprocess import PIPE, Popen

from girder_worker.app import app
from girder_worker.utils import JobStatus


class Config:
    def __init__(self):
        self.pipeline_base_path = os.environ.get(
            'VIAME_PIPELINES_PATH', '/opt/noaa/viame/configs/pipelines/'
        )
        self.viame_install_path = os.environ.get(
            'VIAME_INSTALL_PATH', '/opt/noaa/viame'
        )


# TODO: Need to test with runnable viameweb
@app.task(bind=True)
def run_pipeline(self, input_path, pipeline, input_type):

    conf = Config()
    # Delete is false because the file needs to exist for kwiver to write to
    # The girder upload transform will take care of removing it
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
    process = Popen(
        cmd, stderr=PIPE, stdout=PIPE, shell=True, executable='/bin/bash'
    )
    stdout, stderr = process.communicate()
    if process.returncode > 0:
        raise RuntimeError(
            'Pipeline exited with nonzero status code {}: {}'.format(
                process.returncode, str(stderr)
            )
        )
    else:
        self.job_manager.write(str(stdout) + "\n" + str(stderr))

    # Figure out which of track_output_path, detector_output_path to return
    # Some pipelines don't produce track output, so fallback to returning detector path
    # Both files WILL exist, but if a file hasn't been written to, it will be 0 bytes
    if os.path.getsize(track_output_path) > 0:
        os.remove(detector_output_path)
        return track_output_path
    else:
        os.remove(track_output_path)
        return detector_output_path


@app.task(bind=True)
def convert_video(self, path, folderId, token, auxiliaryFolderId):
    self.girder_client.token = token

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
    process = Popen(command, stderr=PIPE, stdout=PIPE)
    stdout = process.communicate()[0]
    jsoninfo = json.loads(stdout.decode('utf-8'))
    videostream = list(
        filter(lambda x: x["codec_type"] == "video", jsoninfo["streams"])
    )
    if len(videostream) != 1:
        raise Exception(
            'Expected 1 video stream, found {}'.format(len(videostream))
        )

    self.girder_client.addMetadataToFolder(
        folderId,
        {
            "fps": 5,  # TODO: current time system doesn't allow for non-int framerates
            "ffprobe_info": videostream[0],
        },
    )

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
        stderr=PIPE,
        stdout=PIPE,
    )
    stdout, stderr = process.communicate()
    output = str(stdout) + "\n" + str(stderr)
    self.job_manager.write(output)
    _file = self.girder_client.uploadFileToFolder(folderId, output_path)
    self.girder_client.addMetadataToItem(
        _file["itemId"], {"folderId": folderId, "codec": "h264"}
    )
    os.remove(output_path)
