import girder_client
import json
import os
import click

'''
This script is used to sync a folder Hierarchy of Annotation files with a deployed version
It will mimic 
'''


apiURL = "localhost"
port = 8010
baseGirderId = "64c167a0ddec2a1b05eabb76"  # Sample folder 
baseGirderType = "folder" # folder | collection | user
limit = 10  # for testing purposes kkeep lower then increase

# Login to the girder client, interactive means it will prompt for username and password
def login():
    gc = girder_client.GirderClient(apiURL, port=port, apiRoot='girder/api/v1')
    gc.authenticate(interactive=True)
    return gc

# Simple search within folder to get annotation files and their paths
def get_annotations(folder):
    checkFolder = folder
    foundfiles = []
    for root, dirs, files in os.walk(checkFolder):
        for file in files:
            if file.endswith('.csv'):
                # base name exists we can get a list of files
                foundfiles.append(os.path.join(root, file))
    return foundfiles
# returns the girder base path for the indexed folder
def getBasePath(gc: girder_client.GirderClient, folder: str, type: str):
    return gc.sendRestRequest('GET', f'resource/{folder}/path?type={type}')

# attempts to find the filename dataset and the 'Video {filename}' 
def find_dataset(gc: girder_client.GirderClient, filename: str, baseGirderPath: str):
    basename = os.path.basename(filename)
    check_path = filename.replace(basename, f'Video {basename}')
    found = gc.sendRestRequest('GET', f'resource/lookup', parameters={"path": f'{baseGirderPath}/{check_path}'})
    if found:
        if found.get('meta', {}).get('annotate', False):
            return found.get('_id', False)
    # secondary check on the root name with out "Video "
    found = gc.sendRestRequest('GET', f'resource/lookup', parameters={"path": f'{baseGirderPath}/{filename}'})
    if found:
        if found.get('meta', {}).get('annotate', False):
            return found.get('_id', False)
    return False

def upload_annotations(gc: girder_client.GirderClient, annotations):
    for annotation in annotations:
        gc.uploadFileToFolder(annotation['girderId'], annotation['file'])
        gc.sendRestRequest('POST', f'dive_rpc/postprocess/{annotation["girderId"]}', data={'skipTranscoding': True, 'skipJobs': True})

def get_public_folder(gc: girder_client.GirderClient):
    current_user = gc.sendRestRequest('GET', 'user/me')
    userId = current_user['_id']
    folders = gc.sendRestRequest('GET', f'folder?parentType=user&parentId={userId}&text=Public&limit=50&sort=lowerName&sortdir=1')
    if len(folders) > 0:
        uploadFolder = folders[0]['_id']
    else:
        print('No folder found for the user')
    return uploadFolder

@click.command(name="LoadData", help="Load in ")
@click.argument('folder') # a local folder to search for mp4 video files and json/csv files.
def load_data(folder):
    annotations = get_annotations(folder)
    print(annotations)
    gc = login()
    base_path = getBasePath(gc, baseGirderId, baseGirderType)
    print(base_path)
    upload_list = []
    for annotation in annotations:
        print(annotation)
        modifed = annotation.replace(folder, '').replace('.csv', '.mp4')
        result = find_dataset(gc, modifed, base_path)
        if result:
            upload_list.append({
                'girderId': result,
                'file': annotation,
                'type': 'upload'
            })
   
    upload_annotations(gc, upload_list)
if __name__ == '__main__':
    load_data()
