from pathlib import Path

from girder_client import GirderClient, HttpError
import pytest

from .conftest import getClient, getTestFolder, localDataRoot, users, wait_for_jobs, zipUser


@pytest.mark.integration
@pytest.mark.parametrize("user", zipUser.values())
@pytest.mark.run(order=4)
def test_user_creation(admin_client: GirderClient, user: dict):
    try:
        admin_client.createUser(
            user['login'],
            user['email'],
            user['firstName'],
            user['lastName'],
            user['password'],
        )
    except HttpError as err:
        if err.response.json()['message'] != 'That login is already registered.':
            raise err


@pytest.mark.integration
@pytest.mark.parametrize("user", zipUser.values())
@pytest.mark.run(order=4)
def test_reset_integration_env(user: dict):
    client = GirderClient(apiUrl='http://localhost:8010/api/v1')
    client.authenticate(username=user['login'], password=user['password'])
    privateFolder = getTestFolder(client)
    client.delete(f"folder/{privateFolder['_id']}")


@pytest.mark.integration
@pytest.mark.parametrize("user", zipUser.values())
@pytest.mark.run(order=4)
def test_upload_zip_data(user: dict):
    client = GirderClient(apiUrl='http://localhost:8010/api/v1')
    client.authenticate(username=user['login'], password=user['password'])

    createdDatasets = []
    for dataset in user['data']:
        dsPath = localDataRoot / str(dataset['path'])
        privateFolder = getTestFolder(client)
        newDatasetFolder = client.createFolder(
            privateFolder['_id'],
            dataset['name'],
            metadata={
                'fps': dataset['fps'],
                'type': dataset['type'],
            },
        )
        createdDatasets.append(newDatasetFolder)
        if Path(dsPath).is_file():
            client.uploadFileToFolder(newDatasetFolder['_id'], str(dsPath))
        client.post(f'dive_rpc/postprocess/{newDatasetFolder["_id"]}')
    wait_for_jobs(client)
    # Confirm that the new dataset looks like it should.
    for created, expected in zip(createdDatasets, user['data']):
        created = client.get(f'dive_dataset/{created["_id"]}')
        if expected['type'] == 'video':
            assert created['fps'] == expected['originalFps'] or created['fps'] == expected['fps']
            assert created['annotate']
            assert created['originalFps'] == expected['originalFps']
