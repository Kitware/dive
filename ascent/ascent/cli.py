import mimetypes
import os
from pathlib import Path

import click
import girder_client

# TODO
# Upload annotations
# -validate file
# -upload annotation file
# Update existing folder
#  - require id
# -update/overwrite
# Support tags
# -option for upload and update
# Large image

supportedVideoTypes = [
  'video/mp4',
  'video/webm',
  'video/ogg',
]
supportedImageTypes = [
  'image/apng',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
]

_global_options = [
    click.option(
        "--port",
        type=int,
        help="Provide port that DIVE is running on. Default 8010",
    ),
    click.option(
        "--url",
        type=str,
        help="Provide api URL. Defaults to 'localhost'"
    )
]


def global_options(func):
    for option in _global_options:
        func = option(func)
    return func


_upload_arguments = [
    click.argument(
        "folder-name",
        type=str,
        required=True,
    ),
    click.argument(
        "path",
        required=True,
        type=click.Path(exists=True, readable=True, path_type=Path),
    ),

]


def upload_arguments(func):
    for option in _upload_arguments:
        func = option(func)
    return func


apiURL = "localhost"


def login(api, port):
    apiURL = api if api else "localhost"
    local_port = port if port else 8010
    gc = girder_client.GirderClient(
        apiURL,
        port=local_port,
        apiRoot="girder/api/v1"
      )
    if not os.environ.get('DIVE_USER') or not os.environ.get('DIVE_PW'):
        gc.authenticate(interactive=True)
    else:
        gc.authenticate(os.environ.get('DIVE_USER'), os.environ.get('DIVE_PW'))
    return gc


def create_folder(parent_folder, folder_name, gc):
    new_folder = None
    try:
        if parent_folder:
            new_folder = gc.createFolder(
                parent_folder,
                folder_name,
                parentType="folder"
              )
        else:
            me = gc.get("user/me")
            new_folder = gc.createFolder(
                me["_id"],
                folder_name,
                parentType="user"
              )
    except girder_client.HttpError as e:
        if 'name already exists' in e.responseText:
            click.echo(
                "Folder already exists chose unique name."
              )
    return new_folder


@click.group()
def ascent():
    """A cli to interact with the DIVE API """
    pass


@ascent.group()
def upload():
    pass


@upload.command()
@upload_arguments
@global_options
@click.option(
        "--parent-folder",
        type=str,
        help="The _id of girder folder that the new folder will be created in. Defaults to user root."
    )
def image_sequence(parent_folder, folder_name, path: Path, url, port):
    """
    Create folder with FOLDER_NAME in PARENT_FOLDER and upload a set of images from PATH\n

    FOLDER_NAME is a unique name for the folder to be created \n
    PATH is the the local path for the images to be uploaded
    """
    gc = login(url, port)
    new_folder = create_folder(parent_folder, folder_name, gc)

    if new_folder:
        for file in path.iterdir():
            if file.is_file():
                mimetype = mimetypes.guess_type(file.name)
                if mimetype[0] in supportedImageTypes:
                  gc.uploadFileToFolder(new_folder["_id"], file)
        gc.addMetadataToFolder(
            new_folder["_id"],
            {
                "type": "image-sequence",
                "fps": 1,
            },
        )
        gc.sendRestRequest(
            "POST",
            f"dive_rpc/postprocess/{new_folder['_id']}",
            data={"skipTranscoding": True},
        )


@upload.command()
@upload_arguments
@click.option(
        "--parent-folder",
        type=str,
        help="The _id of girder folder that the new folder will be created in. Defaults to user root."
    )
def video(parent_folder, folder_name, path, url, port):
    """
    Create folder with FOLDER_NAME in PARENT_FOLDER and upload a video from PATH\n

    FOLDER_NAME is a unique name for the folder to be created \n
    PATH is the the local path for the video to be uploaded
    """
    gc = login(url, port)
    new_folder = create_folder(parent_folder, folder_name, gc)
    if new_folder:
        gc.uploadFileToFolder(new_folder["_id"], path)
        gc.addMetadataToFolder(
            new_folder["_id"],
            {
                "type": "video",
                "fps": -1,
            },
        )
        gc.sendRestRequest(
            "POST",
            f"dive_rpc/postprocess/{new_folder['_id']}",
            data={"skipTranscoding": True},
        )


@upload.command()
@upload_arguments
@click.option(
        "--parent-folder",
        type=str,
        help="The _id of girder folder that the new folder will be created in. Defaults to user root."
    )
def zip(parent_folder, folder_name, path, url, port):
    """
    Create folder with FOLDER_NAME in PARENT_FOLDER and upload a zip file from PATH\n

    FOLDER_NAME is a unique name for the folder to be created \n
    PATH is the the local path for the zip file to be uploaded
    """
    gc = login(url, port)
    new_folder = create_folder(parent_folder, folder_name, gc)
    if new_folder:
        gc.uploadFileToFolder(new_folder["_id"], path)
# TODO unzip
