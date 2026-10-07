"""Queue input validation, archive isolation and cross-process feedback replay."""

import copy
import zipfile

import pytest

from dive_tasks.query_driver import execute_query, result_key
from dive_utils.query import extract_index, validate_query_request


def request(**overrides):
    return {'operation': 'search', 'indexIds': ['index-a'], 'image': 'png', **overrides}


@pytest.mark.parametrize(
    'overrides',
    [
        {'operation': 'shell'},
        {'indexIds': []},
        {'indexIds': ['a', 'a']},
        {'indexIds': [None]},
        {'image': ''},
        {'image': 'a' * 14_000_001},
        {'boxes': [[0, 0, float('nan'), 2]]},
        {'boxes': [[2, 0, 1, 2]]},
        {'boxes': [[True, 0, 2, 2]]},
        {'feedback': [{'positive': [], 'negative': []}]},
        {'feedback': [{'positive': ['same'], 'negative': ['same']}]},
    ],
)
def test_reject_bad_requests(overrides):
    with pytest.raises(ValueError):
        validate_query_request(request(**overrides))


def test_valid_feedback_and_allowlisted_index_methods():
    feedback = [{'positive': ['result-a'], 'negative': ['result-b']}]
    assert validate_query_request(request(feedback=feedback))['feedback'] == feedback
    with pytest.raises(ValueError):
        validate_query_request({'operation': 'index', 'datasetId': 'a', 'method': '/tmp/evil.pipe'})


@pytest.mark.parametrize(
    'name',
    ['../escape', '/tmp/absolute-query-test', 'database/../../escape', 'database\\..\\escape'],
)
def test_archive_cannot_escape_job_directory(tmp_path, name):
    archive = tmp_path / 'input.zip'
    with zipfile.ZipFile(archive, 'w') as z:
        z.writestr(name, b'bad')
    with pytest.raises(ValueError):
        extract_index(archive, tmp_path / 'output')


def test_archive_symlink_rejected(tmp_path):
    archive = tmp_path / 'input.zip'
    info = zipfile.ZipInfo('database/link')
    info.external_attr = 0o120777 << 16
    with zipfile.ZipFile(archive, 'w') as z:
        z.writestr(info, '/tmp')
    with pytest.raises(ValueError):
        extract_index(archive, tmp_path / 'output')


def test_indexes_extract_to_independent_directories(tmp_path):
    for i in range(2):
        archive = tmp_path / f'{i}.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('database/video.index', str(i))
        extract_index(archive, tmp_path / str(i))
    assert (tmp_path / '0/database/video.index').read_text() == '0'
    assert (tmp_path / '1/database/video.index').read_text() == '1'


def hit(ref='0:1', session=0):
    return {
        'ref': ref,
        'session': session,
        'stream_id': 'video',
        'start_frame': 5,
        'end_frame': 8,
        'tracks': [{'id': 1, 'states': [{'frame': 5, 'bbox': [1, 2, 3, 4]}]}],
        'index_dir': '/private/worker/path',
        'relevancy_score': 0.9,
    }


class Service:
    def __init__(self):
        self.requests = []

    def handle_request(self, request):
        self.requests.append(request)
        return {'results': [hit('0:999'), hit('1:444', session=1)]}


def test_feedback_uses_stable_identity_not_previous_instance_id():
    service = Service()
    result = execute_query(
        service,
        {
            'indexDirs': ['/one', '/two'],
            'datasetIds': ['dataset-a', 'dataset-b'],
            'imagePath': '/image.png',
            'boxes': [],
            'feedback': [{'positive': [result_key(hit('0:1'))], 'negative': []}],
        },
    )
    assert service.requests[-1] == {
        'command': 'refine',
        'positive_ids': ['0:999'],
        'negative_ids': [],
    }
    assert [r['datasetId'] for r in result['results']] == ['dataset-a', 'dataset-b']
    assert all('index_dir' not in r for r in result['results'])


def test_feedback_rejects_results_that_cannot_be_reproduced():
    with pytest.raises(ValueError, match='could not be reproduced'):
        execute_query(
            Service(),
            {
                'indexDirs': ['/one'],
                'datasetIds': ['dataset-a'],
                'imagePath': '/image.png',
                'boxes': [],
                'feedback': [{'positive': ['missing'], 'negative': []}],
            },
        )


def test_stable_key_ignores_score_and_instance_id_but_distinguishes_datasets():
    first = hit()
    second = copy.deepcopy(first)
    second.update(ref='0:1024', relevancy_score=0.1)
    assert result_key(first) == result_key(second)
    second['session'] = 1
    assert result_key(first) != result_key(second)
