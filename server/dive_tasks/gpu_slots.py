"""Coordinate GPU use between normal and high-memory pipeline jobs."""

from contextlib import contextmanager
import os
import socket
import threading
import time
import uuid
from typing import Iterator

from redis import Redis


_LEASE_SECONDS = 300
_HEARTBEAT_SECONDS = 30
_ACQUIRE_SCRIPT = """
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local mode = ARGV[3]
local capacity = tonumber(ARGV[4])
local member = ARGV[5]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local active = redis.call('ZCARD', KEYS[1])
if mode == 'high' then
  if active == 0 then
    redis.call('ZADD', KEYS[1], expires, member)
    return 1
  end
elseif active < capacity then
  redis.call('ZADD', KEYS[1], expires, member)
  return 1
end
return 0
"""
_RENEW_SCRIPT = """
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
  return 1
end
return 0
"""


def _redis_client() -> Redis | None:
    redis_url = os.environ.get('GIRDER_NOTIFICATION_REDIS_URL')
    if not redis_url:
        return None
    return Redis.from_url(redis_url, socket_connect_timeout=5, socket_timeout=5)


def _gpu_key() -> str:
    # Workers without an explicit device UUID must still coordinate with peers;
    # using a deployment-wide fallback is conservative when multiple GPUs exist.
    gpu = os.environ.get('WORKER_GPU_UUID') or 'default'
    return f'dive:gpu-pipeline-slots:{gpu}'


@contextmanager
def gpu_pipeline_slot(pipeline: dict) -> Iterator[None]:
    """Hold a shared slot for ordinary pipes or an exclusive slot for high-memory pipes.

    A Redis lease lets GPU workers coordinate even when they run in different containers.
    The heartbeat keeps long-running pipes from expiring their lease; a worker crash frees
    the slot automatically after five minutes.
    """
    high_memory = (pipeline.get('metadata') or {}).get('gpuMemory') == 'high'
    client = _redis_client()
    if client is None:
        if high_memory:
            raise RuntimeError(
                'This high-memory pipeline requires GIRDER_NOTIFICATION_REDIS_URL '
                'to coordinate GPU access across workers'
            )
        # Older or standalone workers can continue to run normal jobs. Configure
        # shared Redis on every worker using the GPU before enabling high-memory pipes.
        yield
        return
    capacity = max(
        1,
        int(
            os.environ.get('PIPELINE_NORMAL_GPU_SLOTS')
            or os.environ.get('WORKER_CONCURRENCY', '1')
        ),
    )
    key = _gpu_key()
    member = f'{socket.gethostname()}:{os.getpid()}:{uuid.uuid4()}'
    mode = 'high' if high_memory else 'normal'

    while not client.eval(
        _ACQUIRE_SCRIPT,
        1,
        key,
        time.time(),
        time.time() + _LEASE_SECONDS,
        mode,
        capacity,
        member,
    ):
        time.sleep(1)

    stop_heartbeat = threading.Event()

    def renew() -> None:
        while not stop_heartbeat.wait(_HEARTBEAT_SECONDS):
            try:
                renewed = client.eval(
                    _RENEW_SCRIPT, 1, key, member, time.time() + _LEASE_SECONDS
                )
                if not renewed:
                    return
            except Exception:
                # Leave the original lease to expire if Redis is briefly unavailable.
                continue

    heartbeat = threading.Thread(target=renew, daemon=True)
    heartbeat.start()
    try:
        yield
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=_HEARTBEAT_SECONDS + 1)
        client.zrem(key, member)
