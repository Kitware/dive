from typing import List

import pytest

from .conftest import getClient, getTestFolder, users


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=6)
def test_download_annotation(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        downloaded = client.get(f'dive_annotation/?folderId={dataset["_id"]}')
        if 'clone' not in dataset['name']:
            expected: List[dict] = [
                item for item in user['data'] if item['name'] == dataset['name']
            ]
            if len(expected) > 0:
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
            expected: List[dict] = [
                item for item in user['data'] if item['name'] == dataset['name']
            ]
            rows = downloaded.content.decode('utf-8').splitlines()
            track_set = set()
            for row in rows:
                if not row.startswith('#'):
                    track_set.add(row.split(',')[0])
            if len(expected) > 0:
                assert len(track_set) == expected[0]['trackCount']
