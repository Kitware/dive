import pytest

from .conftest import getClient, getTestFolder, localDataRoot, users, wait_for_jobs


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=3)
def test_reset_integration_env(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    client.delete(f"folder/{privateFolder['_id']}")


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=4)
def test_upload_user_data(user: dict):
    client = getClient(user['login'])
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
        for file in dsPath.iterdir():
            if file.is_file():
                client.uploadFileToFolder(newDatasetFolder['_id'], str(file))
        client.post(f'dive_rpc/postprocess/{newDatasetFolder["_id"]}')
    wait_for_jobs(client)
    # Confirm that the new dataset looks like it should.
    for created, expected in zip(createdDatasets, user['data']):
        created = client.get(f'dive_dataset/{created["_id"]}')
        if expected['type'] == 'video':
            assert created['fps'] == expected['originalFps'] or created['fps'] == expected['fps']
            assert created['annotate']
            assert created['originalFps'] == expected['originalFps']
