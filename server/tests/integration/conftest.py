from pathlib import Path
from typing import Any, Dict

from girder_client import GirderClient
import pytest

localDataRoot = Path('tests/integration/data')

users: Dict[str, Dict[str, Any]] = {
    'admin': {
        'login': 'admin',
        'email': 'admin@kitware.com',
        'firstName': 'Admin',
        'lastName': 'User',
        'password': 'letmein',
        'data': [],
    },
    'alice': {
        'login': 'alice',
        'email': 'alice@locahost.lan',
        'firstName': 'Alice',
        'lastName': 'User',
        'password': 'alicespassword',
        'data': [
            {
                'name': 'video1_train_mp4',
                'path': 'TestData/video1_train_mp4',
                'fps': 30,  # Should get reduced.
                'originalFps': 30_000 / 1001,
                'type': 'video',
            },
            {
                'name': 'video2_train_mp4',
                'path': 'TestData/video2_train_mp4',
                'fps': 5.8,
                'originalFps': 30_000 / 1001,
                'type': 'video',
            },
            {
                'name': 'multiConfidence_text',
                'path': 'TestData/multiConfidence_test',
                'fps': 22.1,
                'type': 'image-sequence',
            },
        ],
    },
    'bobby': {
        'login': 'bobby',
        'email': 'bobby@locahost.lan',
        'firstName': 'Bob',
        'lastName': 'User',
        'password': 'bobspass',
        'data': [
            {
                'name': 'testTrain1_imagelist',
                'path': 'TestData/testTrain1_imagelist',
                'fps': 1,
                'type': 'image-sequence',
            },
            {
                'name': 'testTrain2_imagelist',
                'path': 'TestData/testTrain2_imagelist',
                'fps': 6,
                'type': 'image-sequence',
            },
        ],
    },
}


def getClient(name: str) -> GirderClient:
    gc = GirderClient(apiUrl='http://localhost:8010/api/v1')
    gc.authenticate(username=name, password=users[name]['password'])
    return gc


def getTestFolder(client: GirderClient):
    me = client.get('user/me')
    privateFolder = client.loadOrCreateFolder("Integration", me['_id'], 'user')
    return privateFolder


@pytest.fixture(scope="module")
def admin_client() -> GirderClient:
    return getClient('admin')
