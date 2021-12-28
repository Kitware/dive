from pathlib import Path

from girder_client import GirderClient, HttpError
import pytest

from .conftest import getTestFolder, localDataRoot, wait_for_jobs, zipUser


@pytest.mark.integration
@pytest.mark.parametrize("user", [zipUser])
@pytest.mark.run(order=2)
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
@pytest.mark.parametrize("user", [zipUser])
@pytest.mark.run(order=3)
def test_reset_integration_env(user: dict):
    client = GirderClient(apiUrl='http://localhost:8010/api/v1')
    client.authenticate(username=user['login'], password=user['password'])
    privateFolder = getTestFolder(client)
    client.delete(f"folder/{privateFolder['_id']}")


@pytest.mark.integration
@pytest.mark.parametrize("dataset", zipUser['data'])
@pytest.mark.run(order=4)
def test_upload_zip_data(dataset: dict):
    user = zipUser
    client = GirderClient(apiUrl='http://localhost:8010/api/v1')
    client.authenticate(username=user['login'], password=user['password'])

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
    if Path(dsPath).is_file():
        client.uploadFileToFolder(newDatasetFolder['_id'], str(dsPath))
    client.post(f'dive_rpc/postprocess/{newDatasetFolder["_id"]}')
    wait_for_jobs(client, max_wait_timeout=30, expected_status=dataset['job_status'])

    # verify sub datasets if they exist
    if dataset.get('subDatasets', False):
        folders = list(client.listFolder(newDatasetFolder['_id']))
        for item in dataset["subDatasets"]:
            matches = [x for x in folders if x["name"] == item["name"]]
            if len(matches) > 0:
                meta = matches[0].get("meta", {})
                assert meta.get("fps", -1) == item["fps"]
                assert meta.get("type", "") == item["type"]
