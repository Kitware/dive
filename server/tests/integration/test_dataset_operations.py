import pytest
from requests.exceptions import RequestException

from dive_utils import fromMeta

from .conftest import getClient, getTestFolder, localDataRoot, match_user_server_data, users


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=5)
def test_get_media(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        media = client.get(f'dive_dataset/{dataset["_id"]}/media')
        expected = match_user_server_data(user, dataset)
        if len(expected) == 0:
            assert 'clone' in dataset['name']
        dsPath = localDataRoot / str(expected[0].get('path'))
        assert dsPath.exists()
        if fromMeta(dataset, 'type') == 'image-sequence':
            pngs = len(list(dsPath.glob('*.png')))
            jpgs = len(list(dsPath.glob('*.jpg')))
            if pngs > 0:
                assert len(media['imageData']) == pngs
            if jpgs > 0:
                assert len(media['imageData']) == jpgs
        if fromMeta(dataset, 'type') == 'video':
            assert len(media['imageData']) == 0
            assert type(media['video']) == dict
            assert 'mp4' in media['video']['filename']
            client.getFile(media['video']['id'])


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=5)
def test_get_annotations(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    datasets = client.get('dive_dataset')
    for dataset in datasets:
        if dataset['parentId'] == privateFolder["_id"]:
            expected = match_user_server_data(user, dataset)
            if len(expected) == 0:
                assert 'clone' in dataset['name']


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=5)
def test_dataset_clone(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        client.post(
            'dive_dataset',
            parameters={
                'cloneId': dataset['_id'],
                'parentFolderId': privateFolder['_id'],
                'name': dataset['name'] + ' clone',
            },
        )


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=5)
def test_set_configuration(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        client.uploadFileToFolder(dataset['_id'], '../testutils/example.config.json')
        old_meta = client.get(f'dive_dataset/{dataset["_id"]}')
        assert 'another' not in old_meta['confidenceFilters']
        client.post(f'dive_rpc/postprocess/{dataset["_id"]}', data={"skipJobs": True})
        new_meta = client.get(f'dive_dataset/{dataset["_id"]}')
        assert new_meta['confidenceFilters']['another'] == 0.6


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=5)
def test_invalid_upload(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        client.uploadFileToFolder(dataset['_id'], '../testutils/invalid.json')
        with pytest.raises(RequestException):
            client.post(f'dive_rpc/postprocess/{dataset["_id"]}', data={"skipJobs": True})
