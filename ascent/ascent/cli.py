import mimetypes
import os
from pathlib import Path

import click
import girder_client

# TODO
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


_upload_options = [
    click.option(
        "--parent-folder-id",
        type=str,
        help="The _id of girder folder that the new folder will be created in. Defaults to user root."
    ),
    click.option(
        "--annotations-path",
        type=click.Path(exists=True, readable=True, path_type=Path),
        help="Local path for corresponding annotations file to be uploaded."

    )

]


def upload_options(func):
    for option in _upload_options:
        func = option(func)
    return func


apiURL = "localhost"


def login(api, port):

    gc = girder_client.GirderClient(
        api,
        port=port,
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
    "--annotations-included",
    is_flag=True,
    help="Annotations for the image set are in the same directory and should be uploaded"
)
@upload_options
def image_sequence(
    parent_folder_id,
    folder_name,
    path: Path,
    url,
    port,
    annotations_included,
    annotations_path: Path
):
    """
    Create folder with FOLDER_NAME in PARENT_FOLDER and upload a set of images from PATH\n

    FOLDER_NAME is a unique name for the folder to be created \n
    PATH is the the local path for the images to be uploaded
    """
    apiURL = url if url else "localhost"
    local_port = port if port else 8010
    gc = login(apiURL, local_port)
    new_folder = create_folder(parent_folder_id, folder_name, gc)

    if new_folder:
        count = 1
        images = len(list(path.iterdir()))
        for file in path.iterdir():
            if file.is_file():
                if annotations_included:
                    if file.suffix == '.json' or file.suffix == '.csv':
                        images = images - 1
                        gc.uploadFileToFolder(new_folder["_id"], file)
                mimetype = mimetypes.guess_type(file.name)
                if mimetype[0] in supportedImageTypes:
                    click.echo(f"Uploading image {count} of {images}")
                    gc.uploadFileToFolder(new_folder["_id"], file)
                    count = count + 1

        if annotations_path:
            gc.uploadFileToFolder(new_folder["_id"], annotations_path)
        gc.addMetadataToFolder(
            new_folder["_id"],
            {
                "type": "image-sequence",
                "fps": 1,
            },
        )
        click.echo("Processing")
        gc.sendRestRequest(
            "POST",
            f"dive_rpc/postprocess/{new_folder['_id']}",
            data={"skipTranscoding": True},
        )
        click.echo(
            f"Dataset ready at: http://{apiURL}:{local_port}/#/viewer/{new_folder['_id']}"
            )


@upload.command()
@upload_arguments
@upload_options
def video(parent_folder, folder_name, path, url, port, annotations_path: Path):
    """
    Create folder with FOLDER_NAME in PARENT_FOLDER and upload a video from PATH\n

    FOLDER_NAME is a unique name for the folder to be created \n
    PATH is the the local path for the video to be uploaded
    """
    apiURL = url if url else "localhost"
    local_port = port if port else 8010
    gc = login(apiURL, local_port)
    new_folder = create_folder(parent_folder, folder_name, gc)
    if new_folder:
        click.echo("Uploading video.")
        gc.uploadFileToFolder(new_folder["_id"], path)
        if annotations_path:
            gc.uploadFileToFolder(new_folder["_id"], annotations_path)
        gc.addMetadataToFolder(
            new_folder["_id"],
            {
                "type": "video",
                "fps": -1,
            },
        )
        click.echo("Processing")
        gc.sendRestRequest(
            "POST",
            f"dive_rpc/postprocess/{new_folder['_id']}",
            data={"skipTranscoding": True},
        )
        click.echo(
            f"Dataset ready at: http://{apiURL}:{local_port}/#/viewer/{new_folder['_id']}"
        )


@upload.command()
@upload_arguments
@upload_options
def zip(parent_folder, folder_name, path, url, port, annotations_path: Path):
    """
    Create folder with FOLDER_NAME in PARENT_FOLDER and upload a zip file from PATH\n

    FOLDER_NAME is a unique name for the folder to be created \n
    PATH is the the local path for the zip file to be uploaded
    """
    apiURL = url if url else "localhost"
    local_port = port if port else 8010
    gc = login(apiURL, local_port)
    new_folder = create_folder(parent_folder, folder_name, gc)
    if new_folder:
        gc.uploadFileToFolder(new_folder["_id"], path)
        if annotations_path:
            gc.uploadFileToFolder(new_folder["_id"], annotations_path)
        click.echo(
            f"Dataset ready at: http://{apiURL}:{local_port}/#/viewer/{new_folder['_id']}"
        )
# TODO unzip
