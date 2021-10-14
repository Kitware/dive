import json
from pathlib import Path
import time
from typing import Any, Dict, List

from girder_client import GirderClient
import pytest

localDataRoot = Path('tests/integration/data')

"""
Alice and Bobby have different types of data (images and video)
Most tests run operations on a single dataset for each user, so keeping
each user constrained to a single data type will help ensure robustness
"""
users: Dict[str, Dict[str, Any]] = {
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
                'trackCount': 102,
                'pipeline': {
                    "name": "fish",
                    "pipe": "tracker_fish.pipe",
                    "type": "tracker",
                },
            },
            {
                'name': 'video2_train_mp4',
                'path': 'TestData/video2_train_mp4',
                'fps': 5.8,
                'originalFps': 30_000 / 1001,
                'type': 'video',
                'trackCount': 102,
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
                'trackCount': 2,
                'pipeline': {
                    "name": "add segmentations watershed",
                    "pipe": "utility_add_segmentations_watershed.pipe",
                    "type": "utility",
                    'resultTracks': 28,
                },
            },
            {
                'name': 'testTrain2_imagelist',
                'path': 'TestData/testTrain2_imagelist',
                'fps': 6,
                'type': 'image-sequence',
                'trackCount': 1,
                'pipeline': {
                    "name": "empty frame lbls 1fr",
                    "pipe": "utility_empty_frame_lbls_1fr.pipe",
                    "type": "utility",
                    'resultTracks': 14,
                },
            },
            {
                'name': 'multiConfidence_text',
                'path': 'TestData/multiConfidence_test',
                'fps': 22.1,
                'type': 'image-sequence',
                'trackCount': 4,
                'pipeline': {
                    "name": "motion",
                    "pipe": "detector_motion.pipe",
                    "type": "detector",
                },
            },
        ],
    },
    'kwcoco': {
        'login': 'kwcoco',
        'email': 'kwcoco@locahost.lan',
        'firstName': 'KW',
        'lastName': 'COCO',
        'password': 'kwcocopass',
        'data': [
            {
                'name': 'scallops',
                'path': 'kwcoco/scallops',
                'fps': 1,
                'type': 'image-sequence',
                'trackCount': 197,
            },
            {
                'name': 'kwpolys',
                'path': 'kwcoco/polygons',
                'fps': 1,
                'type': 'image-sequence',
                'trackCount': 14,
            },
            {
                'name': 'kwvideo',
                'path': 'kwcoco/video',
                'fps': 29.969,
                'originalFps': 29969 / 1000,
                'type': 'video',
                'trackCount': 6,
            },
        ],
    },
    'testCharacters': {
        'login': 'testCharacters',
        'email': 'testCharacters@locahost.lan',
        'firstName': 't🤢ø三好Дظ',
        'lastName': 't🤢ø三好Дظ',
        'password': 'testCharactersPassword',
        'data': [
            {
                'name': 't🤢ø三好Дظ',
                'path': 'TestData/testTrain1_imagelist',
                'fps': 1,
                'type': 'image-sequence',
                'trackCount': 2,
                'pipeline': {
                    "name": "add segmentations watershed",
                    "pipe": "utility_add_segmentations_watershed.pipe",
                    "type": "utility",
                    'resultTracks': 28,
                },
            }
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
    gc = GirderClient(apiUrl='http://localhost:8010/api/v1')
    gc.authenticate(username='admin', password='letmein')
    return gc


def wait_for_jobs(client: GirderClient, max_wait_timeout=30):
    """Wait for all worker jobs to complete"""
    start_time = time.time()
    incompleteJobs = []
    while True and (time.time() - start_time < max_wait_timeout):
        incompleteJobs = client.get(
            'job',
            parameters={
                # https://github.com/girder/girder/blob/master/plugins/jobs/girder_jobs/constants.py
                # https://github.com/girder/girder_worker/blob/master/girder_worker/girder_plugin/status.py
                'statuses': json.dumps([0, 1, 2, 820, 821, 822, 823, 824]),
            },
        )
        if len(incompleteJobs) == 0:
            break
        time.sleep(1)
    if len(incompleteJobs) > 0:
        raise Exception("Jobs were still running after timeout")
    # Verify that all jobs succeeded
    time.sleep(1)
    lastJob = client.get(
        'job',
        parameters={
            'limit': 1,
        },
    )
    if len(lastJob) > 0 and lastJob[0]['status'] != 3:
        raise Exception("Some jobs did not succeed")


def match_user_server_data(user: Dict[str, Any], dataset) -> List[dict]:
    return [item for item in user['data'] if item['name'] == dataset['name']]
