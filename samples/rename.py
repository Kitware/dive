import json
import os

import click
import girder_client
import csv
from os.path import basename, splitext


apiURL = "viame.kitware.com"
rootFolder = "65a19f18cf5a99794ea99cdb"  # Sample folder girder Id
limit = 10  # for testing purposes keep lower then increase


# Login to the girder client, interactive means it will prompt for username and password
def login():
    gc = girder_client.GirderClient(apiURL, port=443, apiRoot="girder/api/v1", )
    gc.authenticate(interactive=True)
    return gc


def get_dive_datasets(gc: girder_client.GirderClient, rootFolderId: str,):
    folders = gc.listFolder(rootFolderId)
    dive_datasets = {}
    for item in folders:
        if item.get('meta', {}).get('annotate', False) is True:
            # then it's a dive Dataset
            dive_datasets[item['name'].replace('Video ', '').replace('.mp4', '')] = item
        if 'Video ' in item['name']:
            print(f'Renaming: {item["name"]}')
            newname = item['name'].replace('Video ', '').replace('.mp4', '')
            gc.put(f"folder/{item['_id']}", data={'name': newname})
    items = gc.listItem(rootFolderId)
    for item in items:
        if item.get('name').endswith('csv'):
            print(f'Deleting: {item["name"]}')
            gc.delete(f"item/{item['_id']}")


@click.command(name="process NoCopy Imports", help="Load in ")
def load_data():
    gc = login()
    get_dive_datasets(gc, rootFolder)


if __name__ == "__main__":
    load_data()
