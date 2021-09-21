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
                'name': 'MyFolder1',
                'path': 'TestData/video1_train_mp4',
                'fps': 10,
                'type': 'video',
            },
            {
                'name': 'MyFolder2',
                'path': 'TestData/video2_train_mp4',
                'fps': 4,
                'type': 'video',
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
                'name': 'testtrain1',
                'path': 'TestData/testTrain1_imagelist',
                'fps': 1,
                'type': 'image-sequence',
            },
            {
                'name': 'testtrain2',
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


@pytest.fixture(scope="module")
def admin_client() -> GirderClient:
    return getClient('admin')
