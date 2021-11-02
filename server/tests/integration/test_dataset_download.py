import pytest

from .conftest import getClient, getTestFolder, match_user_server_data, users


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=6)
def test_download_annotation(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        downloaded = client.get(f'dive_annotation/?folderId={dataset["_id"]}')
        if 'clone' not in dataset['name']:
            expected = match_user_server_data(user, dataset)
            assert len(downloaded.keys()) == expected[0]['trackCount']


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
        old_tracks = client.get(f'dive_annotation?folderId={dataset["_id"]}')
        newfile = client.uploadFileToFolder(dataset['_id'], '../testutils/tracks.json')
        client.post(f'dive_rpc/postprocess/{dataset["_id"]}', data={"skipJobs": True})
        new_tracks = client.get(f'dive_annotation?folderId={dataset["_id"]}')
        assert '999999' not in old_tracks, "Tracks should have updated"
        assert '999999' in new_tracks, "Should have one track, 999999"
        assert len(new_tracks.keys()) == 1, "Should have a single track"
        client.delete(f'item/{newfile["itemId"]}')  # Remove the uploaded detections
