import json
import os
import re
import tempfile
from subprocess import Popen, PIPE

from girder_worker.app import app
from girder_worker.utils import JobStatus

# TODO: Need to test with runnable viameweb
@app.task(bind=True)
def run_pipeline(self, path, pipeline, input_type):

    # Delete is false because the file needs to exist for kwiver to write to
    # The girder upload transform will take care of removing it
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as temp:
        detector_output_path = temp.name
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as temp:
        track_output_path = temp.name

    # get a list of the input media
    # TODO: better filtering that only allows files of valid types
    directory_files = os.listdir(path)
    filtered_directory_files = []
    for file_name in directory_files:
        full_file_path = os.path.join(path, file_name)
        is_directory = os.path.isdir(full_file_path)
        if (not is_directory) and \
           (not os.path.splitext(file_name)[1].lower() == '.csv'):
            filtered_directory_files.append(file_name)

    if len(filtered_directory_files) == 0:
        raise ValueError('No media files found in {}'.format(path))

    if input_type == 'video':
        file_name = filtered_directory_files[0]
        command = [
            "cd /opt/noaa/viame &&",
            ". ./setup_viame.sh &&",
            "kwiver",
            "runner",
            "-s input:video_reader:type=vidl_ffmpeg",
            "-p /opt/noaa/viame/configs/pipelines/{}".format(pipeline),
            "-s input:video_filename={}".format(os.path.join(path, file_name)),
            "-s detector_writer:file_name={}".format(detector_output_path),
            "-s track_writer:file_name={}".format(track_output_path),
        ]
    elif input_type == 'image-sequence':
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as temp2:
            temp2.writelines(
                (
                    (os.path.join(path, file_name) + "\n").encode()
                    for file_name in sorted(filtered_directory_files)
                )
            )
            image_list_file = temp2.name
        command = [
            "cd /opt/noaa/viame &&",
            ". ./setup_viame.sh &&",
            "kwiver",
            "runner",
            "-p /opt/noaa/viame/configs/pipelines/{}".format(pipeline),
            "-s input:video_filename={}".format(image_list_file),
            "-s detector_writer:file_name={}".format(detector_output_path),
            "-s track_writer:file_name={}".format(track_output_path),
        ]
    else:
        raise ValueError('Unknown input type: {}'.format(input_type))

    cmd = " ".join(command)
    print('Running command:', cmd)
    process = Popen(cmd, stderr=PIPE, stdout=PIPE, shell=True, executable='/bin/bash')
    stdout, stderr = process.communicate()
    if process.returncode > 0:
        raise RuntimeError('Pipeline exited with nonzero status code {}: {}'.format(process.returncode, str(stderr)))
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
        "-print_format", "json",
        "-v", "quiet",
        "-show_format",
        "-show_streams",
        file_name,
    ]
    process = Popen(command, stderr=PIPE, stdout=PIPE)
    stdout = process.communicate()[0]
    jsoninfo = json.loads(stdout.decode('utf-8'))
    videostream = list(filter(lambda x: x["codec_type"] == "video", jsoninfo["streams"]))
    if len(videostream) != 1:
        raise Exception('Expected 1 video stream, found {}'.format(len(videostream)))
    self.girder_client.addMetadataToFolder(folderId, videostream[0])

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
