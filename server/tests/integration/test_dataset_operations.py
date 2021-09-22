from typing import List

import pytest

from dive_utils import fromMeta

from .conftest import getClient, getTestFolder, localDataRoot, users


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=5)
def test_get_media(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        media = client.get(f'dive_dataset/{dataset["_id"]}/media')
        expected: List[dict] = [item for item in user['data'] if item['name'] == dataset['name']]
        if len(expected) == 0:
            assert 'clone' in dataset['name']
        dsPath = localDataRoot / str(expected[0].get('path'))
        assert dsPath.exists()
        if fromMeta(dataset, 'type') == 'image-sequence':
            assert len(list(dsPath.glob('*.png'))) == len(media['imageData'])
        if fromMeta(dataset, 'type') == 'video':
            assert len(media['imageData']) == 0
            assert type(media['video']) == dict
            assert 'mp4' in media['video']['filename']
            client.getFile(media['video']['id'])


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=5)
def test_dataset_clone(user: dict):
    client = getClient(user['login'])
    datasets = client.get('dive_dataset')
    privateFolder = getTestFolder(client)
    client.post(
        'dive_dataset',
        parameters={
            'cloneId': datasets[0]['_id'],
            'parentFolderId': privateFolder['_id'],
            'name': datasets[0]['name'] + ' clone',
        },
    )
