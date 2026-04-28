import os
from typing import Any, Dict
from urllib.parse import quote, urljoin

import requests
from girder.exceptions import RestException

from dive_utils import asbool


def _queue_has_consumers(session: requests.Session, base_url: str, vhost: str, queue: str) -> bool:
    queue_path = f"api/queues/{quote(vhost, safe='')}/{quote(queue, safe='')}"
    response = session.get(urljoin(base_url.rstrip('/') + '/', queue_path), timeout=3)
    response.raise_for_status()
    queue_data: Dict[str, Any] = response.json()
    return int(queue_data.get('consumers', 0)) > 0


def _capability_override(name: str) -> bool | None:
    value = os.environ.get(name)
    if value is None:
        return None
    return asbool(value)


def get_worker_capabilities() -> Dict[str, bool]:
    pipeline_override = _capability_override('DIVE_ENABLE_PIPELINES')
    training_override = _capability_override('DIVE_ENABLE_TRAINING')

    # Optional explicit overrides are useful in deployments without RabbitMQ management API access.
    if pipeline_override is not None or training_override is not None:
        return {
            'pipelinesEnabled': pipeline_override if pipeline_override is not None else False,
            'trainingEnabled': training_override if training_override is not None else False,
        }

    base_url = os.environ.get('RABBITMQ_MANAGEMENT_URL', 'http://rabbit:15672/')
    username = os.environ.get('RABBITMQ_MANAGEMENT_USERNAME', 'guest')
    password = os.environ.get('RABBITMQ_MANAGEMENT_PASSWORD', 'guest')
    vhost = os.environ.get('RABBITMQ_MANAGEMENT_VHOST', 'default')

    capabilities = {
        'pipelinesEnabled': False,
        'trainingEnabled': False,
    }

    try:
        with requests.Session() as session:
            session.auth = (username, password)
            capabilities['pipelinesEnabled'] = _queue_has_consumers(
                session, base_url, vhost, 'pipelines'
            )
            capabilities['trainingEnabled'] = _queue_has_consumers(
                session, base_url, vhost, 'training'
            )
    except requests.RequestException:
        # If queue status cannot be checked, default to disabled for safety.
        pass

    return capabilities


def require_pipeline_worker():
    if not get_worker_capabilities()['pipelinesEnabled']:
        raise RestException(
            'Pipeline execution is unavailable because no pipeline workers are connected.',
            code=503,
        )


def require_training_worker():
    if not get_worker_capabilities()['trainingEnabled']:
        raise RestException(
            'Training is unavailable because no training workers are connected.',
            code=503,
        )
