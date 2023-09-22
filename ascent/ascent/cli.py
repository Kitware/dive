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


_upload_options = [
    click.option(
        "--path",
        required=True,
        type=click.Path(exists=True, readable=True, path_type=Path),
        help="Local location of items(s) to upload"
    ),
    click.option(
        "--parent-folder",
        type=str,
        help="""
        ID of girder folder that will be the parent of created folder.
        Defaults to user root.
        """
    ),
    click.option(
        "--folder-name",
        type=str,
        required=True,
        help="Unique folder name"
    )

]


def upload_options(func):
    for option in _upload_options:
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


@click.group()
def ascent():
    pass


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


@ascent.group()
def upload():
    pass


@upload.command()
@global_options
@upload_options
def image_sequence(parent_folder, folder_name, path: Path, url, port):
    gc = login(url, port)
    new_folder = create_folder(parent_folder, folder_name, gc)
    print("upload image sequence")

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
@upload_options
def video(parent_folder, folder_name, path, url, port):
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
@upload_options
def zip(parent_folder, folder_name, path, url, port):
    gc = login(url, port)
    new_folder = create_folder(parent_folder, folder_name, gc)
    if new_folder:
        gc.uploadFileToFolder(new_folder["_id"], path)
# TODO unzip
