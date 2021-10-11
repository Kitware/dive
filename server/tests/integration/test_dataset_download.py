from typing import List
import pytest

from .conftest import getClient, getTestFolder, localDataRoot, users, wait_for_jobs


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=9)
def test_download_user_data(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        downloaded = client.get(f'dive_annotation/?folderId={dataset["_id"]}')
        if 'clone' not in dataset['name']:
            expected: List[dict] = [item for item in user['data'] if item['name'] == dataset['name']]
            if len(expected) > 0:
                assert len(downloaded.keys())== expected[0]['trackCount']
