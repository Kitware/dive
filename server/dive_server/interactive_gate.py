"""Whether the server-side interactive tools may be used right now."""

from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

from girder.exceptions import RestException
from girder_jobs.models.job import Job, JobStatus
from girder_plugin_worker.status import CustomJobStatus
import requests

BUSY_MESSAGE = 'Interactive segmentation and stereo pause while pipeline or training jobs run.'
OFFLINE_MESSAGE = 'The interactive service is not available on this server.'

# Job types that hold the GPU the interactive service shares.
GPU_JOB_TYPES = ['pipelines', 'training', 'private']
ACTIVE_STATUSES = [
    JobStatus.INACTIVE,
    JobStatus.QUEUED,
    JobStatus.RUNNING,
    CustomJobStatus.CANCELING,
    CustomJobStatus.CONVERTING_OUTPUT,
    CustomJobStatus.CONVERTING_INPUT,
    CustomJobStatus.FETCHING_INPUT,
    CustomJobStatus.PUSHING_OUTPUT,
]

_health_cache: Dict[str, Any] = {'at': 0.0, 'value': None}
HEALTH_TTL = 30.0


def broker_url() -> Optional[str]:
    url = os.environ.get('DIVE_INTERACTIVE_URL', '').strip()
    return url.rstrip('/') or None


def broker_health(force: bool = False) -> Optional[Dict[str, Any]]:
    """The broker's /health, cached briefly; None when unreachable or unset."""
    url = broker_url()
    if not url:
        return None
    now = time.monotonic()
    if not force and now - _health_cache['at'] < HEALTH_TTL:
        return _health_cache['value']
    value: Optional[Dict[str, Any]] = None
    try:
        response = requests.get(f'{url}/health', timeout=3)
        response.raise_for_status()
        value = response.json()
    except (requests.RequestException, ValueError):
        value = None
    _health_cache.update(at=now, value=value)
    return value


def gpu_jobs_active() -> bool:
    return (
        Job().findOne({'type': {'$in': GPU_JOB_TYPES}, 'status': {'$in': ACTIVE_STATUSES}})
        is not None
    )


def get_interactive_capability() -> Dict[str, Any]:
    """What `dive_configuration` reports to the client."""
    health = broker_health()
    if health is None:
        return {'interactiveEnabled': False, 'interactiveMessage': OFFLINE_MESSAGE}
    if gpu_jobs_active():
        return {
            'interactiveEnabled': False,
            'interactiveMessage': BUSY_MESSAGE,
            'interactiveStereoMethods': health.get('stereoMethods', []),
        }
    return {
        'interactiveEnabled': True,
        'interactiveMessage': '',
        'interactiveStereoMethods': health.get('stereoMethods', []),
        'interactiveTextQuery': bool(health.get('textQuery')),
    }


def require_interactive_available() -> str:
    """The broker URL to use, or a 503 saying why not."""
    url = broker_url()
    if not url or broker_health() is None:
        raise RestException(OFFLINE_MESSAGE, code=503)
    if gpu_jobs_active():
        raise RestException(BUSY_MESSAGE, code=503)
    return url
