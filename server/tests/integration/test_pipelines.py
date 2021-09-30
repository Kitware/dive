import json

from girder_client import GirderClient
import pytest

from dive_tasks import tasks

from .conftest import getClient, users, wait_for_jobs


@pytest.mark.integration
@pytest.mark.run(order=5)
def test_reset_job_logs(admin_client: GirderClient):
    # remove any failed jobs.
    for job in admin_client.get('job', parameters={"statuses": json.dumps([0, 1, 2, 4, 5, 824])}):
        admin_client.delete(f'job/{job["_id"]}')


@pytest.mark.integration
@pytest.mark.run(order=6)
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
@pytest.mark.run(order=7)
def test_run_pipelines(user: dict):
    client = getClient(user['login'])
    dataset = client.get('dive_dataset')[0]
    client.post(
        'dive_rpc/pipeline',
        parameters={
            'folderId': dataset["_id"],
            'pipeline': json.dumps(
                {"folderId": None, "name": "fish", "pipe": "tracker_fish.pipe", "type": "tracker"}
            ),
        },
    )
    wait_for_jobs(client, 1000)
    # TODO add some tests to verify that pipelines did the right thing.
