import json
from typing import List

from girder_client import GirderClient
import pytest

from dive_tasks import tasks

from .conftest import getClient, getTestFolder, users, wait_for_jobs


@pytest.mark.integration
@pytest.mark.run(order=7)
def test_reset_job_logs(admin_client: GirderClient):
    # remove any failed jobs.
    for job in admin_client.get('job', parameters={"statuses": json.dumps([0, 1, 2, 4, 5, 824])}):
        admin_client.delete(f'job/{job["_id"]}')


@pytest.mark.integration
@pytest.mark.run(order=8)
def test_upgrade_pipelines(admin_client: GirderClient):
    cnf = admin_client.get('dive_configuration/pipelines')
    if 'detector' not in cnf:
        admin_client.post(
            'dive_configuration/upgrade_pipelines',
            data=json.dumps(tasks.UPGRADE_JOB_DEFAULT_URLS),
        )
    wait_for_jobs(admin_client, 1000)


@pytest.mark.integration
@pytest.mark.parametrize("user", users.values())
@pytest.mark.run(order=9)
def test_run_pipelines(user: dict):
    client = getClient(user['login'])
    privateFolder = getTestFolder(client)
    for dataset in client.listFolder(privateFolder['_id']):
        expected: List[dict] = [item for item in user['data'] if item['name'] == dataset['name']]
        if len(expected) == 0:
            assert 'clone' in dataset['name']
            continue
        if 'pipeline' in expected[0]:
            pipeline = expected[0]['pipeline']
            client.post(
                'dive_rpc/pipeline',
                parameters={
                    'folderId': dataset["_id"],
                    'pipeline': json.dumps(
                        {
                            "folderId": None,
                            "name": pipeline["name"],
                            "pipe": pipeline["pipe"],
                            "type": pipeline["type"],
                        }
                    ),
                },
            )
            wait_for_jobs(client, 1000)
            # some pipelines have consistent return values, check them here
            if 'resultTracks' in pipeline:
                result_tracks = pipeline['resultTracks']
                downloaded = client.sendRestRequest(
                    'GET',
                    f'dive_annotation/export?includeMedia=false&includeDetections=true&excludeBelowThreshold=false&folderId={dataset["_id"]}',
                    jsonResp=False,
                )
                rows = downloaded.content.decode('utf-8').splitlines()
                track_set = set()
                for row in rows:
                    if not row.startswith('#'):
                        track_set.add(row.split(',')[0])
                if len(expected) > 0:
                    assert len(track_set) == result_tracks
