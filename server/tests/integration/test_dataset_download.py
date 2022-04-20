import io
import json
import os
from zipfile import ZipFile

import pytest

from .conftest import getClient, getTestFolder, match_user_server_data, users


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=6)
def test_download_annotation(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        downloaded = client.get(f'dive_annotation/track?folderId={dataset["_id"]}')
        if 'clone' not in dataset['name']:
            expected = match_user_server_data(user, dataset)
            assert len(downloaded) == expected[0]['trackCount']


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=6)
def test_download_csv(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        downloaded = client.sendRestRequest(
            'GET',
            f'dive_annotation/export?includeMedia=false&includeDetections=true&excludeBelowThreshold=false&folderId={dataset["_id"]}',
            jsonResp=False,
        )
        if 'clone' not in dataset['name']:
            expected = match_user_server_data(user, dataset)
            rows = downloaded.content.decode('utf-8').splitlines()
            track_set = set()
            for row in rows:
                if not row.startswith('#'):
                    track_set.add(row.split(',')[0])
            assert len(track_set) == expected[0]['trackCount']


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=6)
def test_zip_download(user: dict):
    if user['login'] == 'testCharacters':  # listFolder returns non slugified folder names.
        return
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        downloaded = client.sendRestRequest(
            'GET',
            f'dive_dataset/export?includeMedia=true&includeDetections=true&excludeBelowThreshold=false&folderIds={json.dumps([dataset["_id"]])}',
            jsonResp=False,
        )
        z = ZipFile(io.BytesIO(downloaded.content))
        folder_name = list(set([os.path.dirname(x) for x in z.namelist()]))[0]
        assert folder_name == dataset['name']


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=6)
def test_zip_batch_download(user: dict):
    if user['login'] == 'testCharacters':  # listFolder returns non slugified folder names.
        return
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    datasetIds = []
    datasetNames = []
    for dataset in client.listFolder(privateFolder['_id']):
        datasetIds.append(dataset["_id"])
        datasetNames.append(dataset["name"])
    downloaded = client.sendRestRequest(
        'GET',
        f'dive_dataset/export?includeMedia=true&includeDetections=true&excludeBelowThreshold=false&folderIds={json.dumps(datasetIds)}',
        jsonResp=False,
    )
    z = ZipFile(io.BytesIO(downloaded.content))
    folder_names = list(set([os.path.dirname(x) for x in z.namelist()]))
    assert len(folder_names) == len(datasetNames)


@pytest.mark.integration
@pytest.mark.run(order=7)
def test_failed_batch_download():
    user = users['alice']
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    datasetIds = []
    datasetNames = []
    failed_datasets = []
    for dataset in client.listFolder(privateFolder['_id']):
        if 'clone' not in dataset["name"] and 'train_mp4' in dataset['name']:
            client.sendRestRequest('DELETE', f'folder/{dataset["_id"]}')
            failed_datasets.append(dataset["name"])
            continue
        datasetIds.append(dataset["_id"])
        datasetNames.append(dataset["name"])
    downloaded = client.sendRestRequest(
        'GET',
        f'dive_dataset/export?includeMedia=true&includeDetections=true&excludeBelowThreshold=false&folderIds={json.dumps(datasetIds)}',
        jsonResp=False,
    )
    z = ZipFile(io.BytesIO(downloaded.content))
    print(z.namelist())
    assert 'failed_datasets.txt' in z.namelist()
    failed_string = z.read('failed_datasets.txt').decode('utf-8')
    for failed in failed_datasets:
        assert failed in failed_string


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=7)
def test_upload_json_detections(user: dict):
    """
    Upload new annotations, and verify that the existing annotations change.
    This test cleans up after itself, and does not change the state of the system
    for future tests
    """
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        old_tracks_list = client.get(f'dive_annotation/track?folderId={dataset["_id"]}')
        old_tracks = {str(track['id']): track for track in old_tracks_list}
        assert '999999' not in old_tracks, "Tracks should have updated"
        old_revision = client.get(f'dive_annotation/revision?folderId={dataset["_id"]}')[0][
            'revision'
        ]
        client.uploadFileToFolder(dataset['_id'], '../testutils/tracks.json')
        client.post(f'dive_rpc/postprocess/{dataset["_id"]}', data={"skipJobs": True})
        new_tracks_list = client.get(f'dive_annotation/track?folderId={dataset["_id"]}')
        new_tracks = {str(track['id']): track for track in new_tracks_list}
        assert '999999' in new_tracks, "Should have one track, 999999"
        assert len(new_tracks_list) == 1, "Should have a single track"
        client.post(f'dive_annotation/rollback?folderId={dataset["_id"]}&revision={old_revision}')
