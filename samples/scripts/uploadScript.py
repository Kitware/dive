import girder_client
import json
import os
import click


apiURL = "localhost"
rootUploadFolder = "642577ffac91ad91682b0298"  # Sample folder girder Id
limit = 10  # for testing purposes kkeep lower then increase

# Login to the girder client, interactive means it will prompt for username and password
def login():
    gc = girder_client.GirderClient(apiURL, port=8010, apiRoot='girder/api/v1')
    gc.authenticate(interactive=True)
    return gc

# Simple search within folder for videos and json files (could do by mimetype instead)
def get_videos(folder):
    videomap = {}
    count = 0
    for file in os.listdir(folder):
        if count >= limit:
            break
        if file.endswith(".mp4"):
            replaced = file.replace('.mp4', '')
            if replaced not in videomap.keys():
                videomap[replaced] = {}
            videomap[replaced]['video'] = os.path.join(folder, file)
        # check for JSON/CSV files with the same name as the video file
        if file.endswith(".json"):
            replaced = file.replace('.json', '')
            if replaced not in videomap.keys():
                videomap[replaced] = {}
            videomap[replaced]['json'] = os.path.join(folder, file)
        if file.endswith(".csv"):
            replaced = file.replace('.csv', '')
            if replaced not in videomap.keys():
                videomap[replaced] = {}
            videomap[replaced]['csv'] = os.path.join(folder, file)
        count = count + 1
    return videomap


@click.command(name="LoadData", help="Load in ")
@click.argument('folder') # a local folder to search for mp4 video files and json/csv files.
def load_data(folder):
    # search the folder for .mp4 videos and JSON files
    videomap = get_videos(folder)
    # now we create folders and upload the video files to them.
    gc = login()
    keys = videomap.keys()
    count = 1
    for key in keys:
        item = videomap[key]
        print(f'Creating Folder: {key}.mp4')
        new_folder = gc.createFolder(rootUploadFolder, f'{key}.mp4')
        # upload the video file to the folder
        gc.uploadFileToFolder(new_folder['_id'], item['video'])
        # upload annotations in JSON or CSV Format
        if 'json' in item.keys():
            gc.uploadFileToFolder(new_folder['_id'], item['json'])
        if 'csv' in item.keys():
            gc.uploadFileToFolder(new_folder['_id'], item['csv'])
        # Now we send a postprocess request
        newFolderId = str(new_folder['_id'])
        # required metadata to be set on the folder for post processing to work properly
        gc.addMetadataToFolder(newFolderId, { 'type': 'video', 'fps': -1, })

        gc.sendRestRequest('POST', f'dive_rpc/postprocess/{newFolderId}', data={'skipTranscoding': True})
        print(f'Completed: {count} out of {len(keys)}')
        count = count + 1

if __name__ == '__main__':
    load_data()
