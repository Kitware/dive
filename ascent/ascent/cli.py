import os
from pathlib import Path

import click
import girder_client

_global_options = [
    click.option(
        "-p",
        "--port",
        type=int,
        help="Provide port that DIVE is running on. Default 8010",
    ),
    click.option(
        "-u",
        "--url",
        type=str,
        help="Provide api URL. Defaults to 'localhost'"
    )
]


def global_options(func):
    for option in _global_options:
        func = option(func)
    return func


apiURL = "localhost"


def login():
    gc = girder_client.GirderClient(apiURL, port=8010, apiRoot="girder/api/v1")
    if not os.environ.get('DIVE_USER') or not os.environ.get('DIVE_PW'):
        gc.authenticate(interactive=True)
    else:
        gc.authenticate(os.environ.get('DIVE_USER'), os.environ.get('DIVE_PW'))
    return gc


@click.group()
def ascent():
    pass


@ascent.command(name="upload", help="Upload to your girder folder")
@click.argument(
    "image",
    type=click.Path(exists=True, readable=True, path_type=Path),
)
@global_options
@click.option(
    "--parent-folder",
    type=str,
    help="ID of girder folder that will be the parent of created folder. Defaults to user root."
)
@click.option("--folder-name",
              type=str,
              required=True,
              help="Unique folder name"
              )
def upload(image, url, port, parent_folder, folder_name):
    new_folder = None
    gc = login()
    try:
        if parent_folder:
            new_folder = gc.createFolder(parent_folder, folder_name, parentType="folder")
        else:
            me = gc.get("user/me")
            new_folder = gc.createFolder(me["_id"], folder_name, parentType="user")
    except girder_client.HttpError as e:
        if 'name already exists' in e.responseText:
            click.echo("Folder already exists chose unique name or use the update command.")
    if new_folder:
        gc.uploadFileToFolder(new_folder["_id"], image)
        gc.addMetadataToFolder(
            new_folder["_id"],
            {
                "type": "dataset",
                "fps": -1,
            },
        )
        gc.sendRestRequest(
            "POST",
            f"dive_rpc/postprocess/{new_folder['_id']}",
            data={"skipTranscoding": True},
        )
