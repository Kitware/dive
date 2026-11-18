"""Coordinate GPU memory reservations between VIAME worker tasks."""

from contextlib import contextmanager
import os
import socket
import threading
import time
from typing import Callable, Iterator, Optional
import uuid

from GPUtil import getGPUs
from redis import Redis

from dive_tasks.utils import CanceledError

_DEFAULT_PIPELINE_MEMORY_GB = 8.0
_LEASE_SECONDS = 300
_HEARTBEAT_SECONDS = 30
# Safety net so a worker is not stuck forever when VRAM never frees up.
# Cancel checks are the primary way jobs leave the wait; this is a backstop.
_DEFAULT_ACQUIRE_TIMEOUT_SECONDS = 12 * 60 * 60
_ACQUIRE_POLL_SECONDS = 1
LEASE_LOST_MESSAGE = (
    'GPU memory lease was lost (missing or expired); '
    'stopping to avoid overlapping VRAM use with another worker'
)


class GpuLeaseLostError(RuntimeError):
    """Raised when the Redis GPU reservation can no longer be renewed."""

    def __init__(self, message: str = LEASE_LOST_MESSAGE):
        super().__init__(message)


_ACQUIRE_SCRIPT = """
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local reservation = tonumber(ARGV[3])
local capacity = tonumber(ARGV[4])
local member = ARGV[5]
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now)
for _, old_member in ipairs(expired) do
  redis.call('ZREM', KEYS[1], old_member)
  redis.call('HDEL', KEYS[2], old_member)
end
local active = redis.call('HVALS', KEYS[2])
local used = 0
for _, value in ipairs(active) do
  used = used + tonumber(value)
end
if used + reservation <= capacity then
  redis.call('HSET', KEYS[2], member, reservation)
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
    # Workers without an explicit device UUID still coordinate with their peers.
    gpu = os.environ.get('WORKER_GPU_UUID') or 'default'
    return f'dive:gpu-memory-reservations:{gpu}'


def _gpu_capacity_gb() -> float:
    worker_gpu_uuid = os.environ.get('WORKER_GPU_UUID')
    gpus = getGPUs()
    if worker_gpu_uuid:
        gpu = next((gpu for gpu in gpus if gpu.uuid == worker_gpu_uuid), None)
        capacity_gb = float(gpu.memoryTotal) / 1024.0 if gpu else None
    elif gpus:
        # Without a pinned UUID, tasks may land on any visible GPU. Use the
        # smallest device as a conservative shared budget for this worker group.
        capacity_gb = min(float(gpu.memoryTotal) / 1024.0 for gpu in gpus)
    else:
        capacity_gb = None
    if capacity_gb is None:
        raise RuntimeError('Could not detect the worker GPU memory using nvidia-smi')
    capacity = capacity_gb
    if capacity <= 0:
        raise RuntimeError('Detected GPU memory capacity must be greater than zero')
    return capacity


def _acquire_timeout_seconds(override: Optional[float]) -> Optional[float]:
    """Return seconds to wait for a slot, or None for no timeout.

    ``override`` wins when provided. Otherwise ``DIVE_GPU_ACQUIRE_TIMEOUT_SECONDS``
    is used when set (``0`` or negative disables the timeout). Default is 12h.
    """
    if override is not None:
        return None if override <= 0 else override
    raw = os.environ.get('DIVE_GPU_ACQUIRE_TIMEOUT_SECONDS')
    if raw is not None and raw != '':
        value = float(raw)
        return None if value <= 0 else value
    return _DEFAULT_ACQUIRE_TIMEOUT_SECONDS


@contextmanager
def gpu_memory_slot(
    pipeline: dict,
    *,
    reserve_all: bool = False,
    check_canceled: Optional[Callable[[], bool]] = None,
    log: Optional[Callable[[str], None]] = None,
    acquire_timeout_seconds: Optional[float] = None,
) -> Iterator[threading.Event]:
    """Reserve the pipe's declared VRAM amount, or the whole GPU for exclusive work.

    Yields an Event that is set if the Redis lease can no longer be renewed.
    Pass that Event to ``stream_subprocess(..., abort_event=...)`` so the VIAME
    process is killed instead of continuing without a reservation.

    While waiting for free VRAM, ``check_canceled`` is polled each second so a
    canceled job can leave FETCHING_INPUT instead of blocking the worker.
    ``log`` is called once when the job must wait for capacity (job log / UI).
    ``acquire_timeout_seconds`` (default 12h, or ``DIVE_GPU_ACQUIRE_TIMEOUT_SECONDS``)
    is a backstop if the slot never becomes available.
    """
    metadata = pipeline.get('metadata') or {}
    if metadata.get('gpuMemoryInvalid'):
        raise RuntimeError('Invalid # GPU Memory header; use `High` or a number of GB')
    explicitly_declared = bool(metadata.get('gpuMemoryDeclared'))
    exclusive = reserve_all or bool(metadata.get('gpuMemoryExclusive'))
    declared_reservation = metadata.get('gpuMemoryGB')
    reservation = float(
        _DEFAULT_PIPELINE_MEMORY_GB if declared_reservation is None else declared_reservation
    )
    lease_lost = threading.Event()
    client = _redis_client()
    if client is None:
        if explicitly_declared:
            raise RuntimeError(
                'This pipeline declares `# GPU Memory` and requires '
                'GIRDER_NOTIFICATION_REDIS_URL to coordinate GPU access across workers'
            )
        # Unmarked pipes and internal whole-GPU tasks (training, export) keep
        # their historical uncoordinated behavior on standalone workers.
        yield lease_lost
        return

    capacity = _gpu_capacity_gb()
    if exclusive:
        reservation = capacity
    elif not explicitly_declared:
        # The default budget is a guess; never let it make an unmarked pipe
        # unrunnable on a GPU smaller than the default.
        reservation = min(reservation, capacity)
    if reservation <= 0:
        raise RuntimeError('GPU memory reservation must be greater than zero')
    if reservation > capacity:
        raise RuntimeError(
            f'Pipeline requests {reservation:g} GB of GPU memory but the worker GPU '
            f'capacity is {capacity:g} GB'
        )

    lease_key = _gpu_key()
    reservation_key = f'{lease_key}:amounts'
    member = f'{socket.gethostname()}:{os.getpid()}:{uuid.uuid4()}'
    timeout = _acquire_timeout_seconds(acquire_timeout_seconds)
    started = time.time()
    logged_waiting = False
    while not client.eval(
        _ACQUIRE_SCRIPT,
        2,
        lease_key,
        reservation_key,
        time.time(),
        time.time() + _LEASE_SECONDS,
        reservation,
        capacity,
        member,
    ):
        if not logged_waiting:
            kind = ' (exclusive / full GPU)' if exclusive or reserve_all else ''
            message = (
                f'Waiting for {reservation:g} GB of free GPU memory{kind} '
                f'before starting (capacity {capacity:g} GB)...\n'
            )
            if log is not None:
                log(message)
            logged_waiting = True
        if check_canceled is not None and check_canceled():
            raise CanceledError('Job was canceled while waiting for GPU memory')
        if timeout is not None and (time.time() - started) >= timeout:
            raise RuntimeError(
                f'Timed out after {timeout:g}s waiting for {reservation:g} GB of GPU memory'
            )
        time.sleep(_ACQUIRE_POLL_SECONDS)
    if logged_waiting and log is not None:
        log(f'GPU memory available; acquired {reservation:g} GB reservation.\n')

    stop_heartbeat = threading.Event()

    def renew() -> None:
        while not stop_heartbeat.wait(_HEARTBEAT_SECONDS):
            try:
                renewed = client.eval(
                    _RENEW_SCRIPT, 1, lease_key, member, time.time() + _LEASE_SECONDS
                )
                if not renewed:
                    # Fail closed: the reservation is gone, so another worker may
                    # claim this VRAM. Signal callers to stop the GPU process.
                    lease_lost.set()
                    return
            except Exception:
                # Leave the original lease to expire if Redis is briefly unavailable.
                # Once Redis returns, a missing member makes renew fail closed above.
                continue

    heartbeat = threading.Thread(target=renew, daemon=True)
    heartbeat.start()
    try:
        yield lease_lost
        if lease_lost.is_set():
            raise GpuLeaseLostError()
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=_HEARTBEAT_SECONDS + 1)
        # Never let a release failure mask the exception already in flight
        # (e.g. CanceledError); the lease expires on its own after _LEASE_SECONDS.
        try:
            client.zrem(lease_key, member)
            client.hdel(reservation_key, member)
        except Exception as err:
            print(f'Failed to release GPU memory reservation {member}: {err}')
