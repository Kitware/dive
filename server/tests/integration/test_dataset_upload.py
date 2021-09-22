import json
import time

from girder_client import GirderClient
import pytest

from .conftest import getClient, getTestFolder, localDataRoot, users


def wait_for_jobs(client: GirderClient, max_wait_timeout=30):
    """Wait for all worker jobs to complete"""
    start_time = time.time()
    incompleteJobs = []
    while True and (time.time() - start_time < max_wait_timeout):
        incompleteJobs = client.get(
            'job',
            parameters={
                'statuses': json.dumps([0, 1, 2]),
            },
        )
        if len(incompleteJobs) == 0:
            break
        time.sleep(1)
    if len(incompleteJobs) > 0:
        raise Exception("Jobs were still running after timeout")
    # Verify that all jobs succeeded
    did_not_succeed = client.get('job', parameters={'statuses': json.dumps([4, 5])})
    if len(did_not_succeed) > 0:
        raise Exception("Some jobs did not succeed")


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
