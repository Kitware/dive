import json
from pathlib import Path
import time

from girder_client import GirderClient
import pytest

from .conftest import getClient, users


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
@pytest.mark.run(order=2)
def test_upload_user_data(user: dict):
    client = getClient(user['login'])
    localDataRoot = Path('tests/integration/data')
    for dataset in user['data']:
        dsPath = localDataRoot / str(dataset['path'])
        me = client.get('user/me')
        privateFolder = client.loadOrCreateFolder("Private", me['_id'], 'user')
        newDatasetFolder = client.createFolder(
            privateFolder['_id'],
            dataset['name'],
            metadata={
                'fps': dataset['fps'],
                'type': dataset['type'],
            },
        )
        for file in dsPath.iterdir():
            if file.is_file():
                client.uploadFileToFolder(newDatasetFolder['_id'], str(file))
        client.post(f'dive_rpc/postprocess/{newDatasetFolder["_id"]}')
    wait_for_jobs(client)


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=3)
def test_dataset_clone(user: dict):
    client = getClient(user['login'])
    datasets = client.get('dive_dataset')
    assert len(datasets) == len(user['data'])
