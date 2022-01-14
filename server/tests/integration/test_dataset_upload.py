import json

from girder.constants import AccessType
from girder_client import HttpError
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
        # Validate the fileset
        filenames = [file.name for file in dsPath.iterdir()]
        valid = client.post('dive_dataset/validate_files', json=filenames)
        assert valid['ok'], 'File validation failed'
        for file in dsPath.iterdir():
            if file.is_file():
                client.uploadFileToFolder(newDatasetFolder['_id'], str(file))
        client.post(f'dive_rpc/postprocess/{newDatasetFolder["_id"]}')
        if dataset.get('sharedWith', False):
            me = client.get('user/me')
            otherClient = getClient(dataset['sharedWith'])
            otherUser = otherClient.get('user/me')
            with pytest.raises(HttpError):
                otherClient.get(f'dive_dataset/{newDatasetFolder["_id"]}')
            client.put(
                f'folder/{newDatasetFolder["_id"]}/access',
                data={
                    'public': False,
                    'recurse': False,
                    'progress': False,
                    'access': json.dumps(
                        {
                            'users': [
                                {'id': me['_id'], 'level': AccessType.ADMIN, 'flags': []},
                                {'id': otherUser['_id'], 'level': AccessType.READ, 'flags': []},
                            ],
                            'groups': [],
                        }
                    ),
                },
            )
            assert (
                otherClient.get(
                    f'dive_dataset/{newDatasetFolder["_id"]}', jsonResp=False
                ).status_code
                == 200
            )

    wait_for_jobs(client)
    # Confirm that the new dataset looks like it should.
    for created, expected in zip(createdDatasets, user['data']):
        created = client.get(f'dive_dataset/{created["_id"]}')
        if expected['type'] == 'video':
            assert created['fps'] == expected['originalFps'] or created['fps'] == expected['fps']
            assert created['annotate']
            assert created['originalFps'] == expected['originalFps']
