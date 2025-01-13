import os
import click
import girder_client
from datetime import datetime, timedelta, timezone

apiURL = "viame.kitware.com"
port = 443
baseFolderIds = ["66d76d42a71db63d08401aa7"]  # Sample folder girder Id
export_format = 'viame_csv' # viame_csv or dive_json


# Login to the girder client, interactive means it will prompt for username and password
def login():
    gc = girder_client.GirderClient(apiURL, port=port, apiRoot="girder/api/v1")
    gc.authenticate(interactive=True)
    return gc


# Function to recursively search for DIVE datasets
def find_dive_datasets(gc, parent_id):
    export_folders = []
    folders = gc.listFolder(parent_id)
    for folder in folders:
        if folder['meta'].get('annotate') == True:
            export_folders.append({'id': folder['_id'], 'name': folder['name']})
        export_folders += find_dive_datasets(gc, folder['_id'])
    
    return export_folders

# Function to export annotations
def export_annotations(gc, datasets):
    for folder_info in datasets:
        folder_id = folder_info['id']
        folder_name = folder_info['name']
        folder = gc.get(f'folder/{folder_id}')
        folder_name = folder['name']
        export_path = f'./exports/{folder_name}'
        os.makedirs(export_path, exist_ok=True)
        
        # Export annotations
        # Annotations are returning a file so we need the raw data to download
        response = gc.sendRestRequest(
            "GET",
            "dive_annotation/export",
            parameters={'folderId': folder_id, 'format': export_format},
            jsonResp=False,  # Ensure we get raw response for file handling
        )

        extension = 'csv' if export_format == 'viame_csv' else 'json'
        output_file = os.path.join(export_path, f'annotations.{extension}')
        with open(output_file, 'wb') as f:  # Open the file in binary write mode
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)


@click.command(name="ExportAnnotations", help="Export annotations from DIVE datasets")
def main():
    gc = login()
    datasets = []
    for parent_id in baseFolderIds:
        datasets += find_dive_datasets(gc, parent_id)

    export_annotations(gc, datasets)

if __name__ == '__main__':
    main()