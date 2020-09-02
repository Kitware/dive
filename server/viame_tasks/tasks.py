import json
import os
import tempfile
from pathlib import Path
from subprocess import PIPE, Popen

from girder_worker.app import app


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
    process = Popen(cmd, stderr=PIPE, stdout=PIPE, shell=True, executable='/bin/bash')
    stdout, stderr = process.communicate()
    if process.returncode > 0:
        raise RuntimeError(
            'Pipeline exited with nonzero status code {}: {}'.format(
                process.returncode, str(stderr)
            )
        )
    else:
        self.job_manager.write(str(stdout) + "\n" + str(stderr))

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
    process = Popen(command, stderr=PIPE, stdout=PIPE)
    stdout = process.communicate()[0]
    jsoninfo = json.loads(stdout.decode('utf-8'))
    videostream = list(
        filter(lambda x: x["codec_type"] == "video", jsoninfo["streams"])
    )
    if len(videostream) != 1:
        raise Exception('Expected 1 video stream, found {}'.format(len(videostream)))

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

            process = Popen(
                ["ffmpeg", "-i", item_path, new_item_path],
                stdout=PIPE,
                stderr=PIPE,
            )
            stdout, stderr = process.communicate()

            output = ""
            if len(stdout):
                output = f"{stdout.decode()}\n"
            if len(stderr):
                output = f"{output}{stderr.decode()}\n"

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
