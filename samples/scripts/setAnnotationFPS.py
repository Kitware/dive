import json
import os

import click
import girder_client

apiURL = "localhost"
rootFolder = "642577ffac91ad91682b0298"  # Sample folder girder Id


# Login to the girder client, interactive means it will prompt for username and password
def login():
    gc = girder_client.GirderClient(apiURL, port=8010, apiRoot="girder/api/v1")
    gc.authenticate(interactive=True)
    return gc


def getFolderList(gc: girder_client.GirderClient, folderId, parentType="folder"):
    folders = list(gc.listFolder(folderId, parentFolderType=parentType))
    return folders

def process_folder(gc: girder_client.GirderClient, folderId, fps):
    folders = getFolderList(gc,folderId)
    processed = []
    for folder in folders:
        if folder.get('meta', {}).get('annotate', False):  # is a DIVE Dataset
            old_annotation_fps = folder.get('meta', {},).get('fps', None)
            video_fps = folder.get('meta', {},).get('orignalFps', None)
            gc.addMetadataToFolder(str(folder['_id']), {
                "fps": fps
            })
            processed.append({
                'name': folder.get('name', 'unknown'),
                'oldAnnotationFPS': old_annotation_fps,
                'newAnnotationFPS': fps,
                'videoFPS': video_fps,
            })
        else:
            processed = processed + process_folder(gc, str(folder['_id']), fps)

    return processed
@click.command(name="LoadData", help="Load in ")
@click.argument(
    "fps"
)  # An numerical FPS value to annotate bas
def load_data(fps):
    gc = login()
    # Search the root folder for a list of folders
    processed = process_folder(gc, rootFolder, fps)
    with open('processed.json', 'w', encoding='utf8') as outfile:
        json.dump(processed, outfile, ensure_ascii=False, indent=True)

if __name__ == "__main__":
    load_data()
