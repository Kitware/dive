import threading
from unittest.mock import MagicMock

import pytest

from dive_tasks import gpu_slots
from dive_tasks.gpu_slots import GpuLeaseLostError, gpu_memory_slot
from dive_tasks.utils import CanceledError


def test_renew_failure_sets_lease_lost_event(monkeypatch):
    """A missing/expired lease must fail closed instead of exiting silently."""
    client = MagicMock()
    # First eval acquires; subsequent renews return 0 (lease gone).
    client.eval.side_effect = [1, 0]
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: client)
    monkeypatch.setattr(gpu_slots, '_gpu_capacity_gb', lambda: 16.0)
    monkeypatch.setattr(gpu_slots, '_HEARTBEAT_SECONDS', 0.05)
    monkeypatch.setattr(gpu_slots, '_LEASE_SECONDS', 1)

    with pytest.raises(GpuLeaseLostError, match='lease was lost'):
        with gpu_memory_slot({'metadata': {'gpuMemoryGB': 4, 'gpuMemoryDeclared': True}}) as lost:
            assert lost.wait(timeout=2)


def test_standalone_worker_yields_unset_event(monkeypatch):
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: None)
    with gpu_memory_slot({}) as lost:
        assert isinstance(lost, threading.Event)
        assert not lost.is_set()


class _FakeClock:
    def __init__(self):
        self.now = 0.0

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def test_acquire_canceled_while_waiting(monkeypatch):
    client = MagicMock()
    client.eval.return_value = 0
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: client)
    monkeypatch.setattr(gpu_slots, '_gpu_capacity_gb', lambda: 16.0)
    clock = _FakeClock()
    monkeypatch.setattr(gpu_slots.time, 'time', clock.time)
    monkeypatch.setattr(gpu_slots.time, 'sleep', clock.sleep)

    checks = {'n': 0}

    def check_canceled():
        checks['n'] += 1
        return checks['n'] >= 2

    with pytest.raises(CanceledError, match='waiting for GPU memory'):
        with gpu_memory_slot(
            {'metadata': {'gpuMemoryGB': 4, 'gpuMemoryDeclared': True}},
            check_canceled=check_canceled,
        ):
            pass


def test_acquire_logs_while_waiting(monkeypatch):
    client = MagicMock()
    client.eval.side_effect = [0, 1]
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: client)
    monkeypatch.setattr(gpu_slots, '_gpu_capacity_gb', lambda: 16.0)
    clock = _FakeClock()
    monkeypatch.setattr(gpu_slots.time, 'time', clock.time)
    monkeypatch.setattr(gpu_slots.time, 'sleep', clock.sleep)
    messages = []

    with gpu_memory_slot(
        {'metadata': {'gpuMemoryGB': 4, 'gpuMemoryDeclared': True}},
        log=messages.append,
    ):
        pass

    assert any('Waiting for 4 GB of free GPU memory' in msg for msg in messages)
    assert any('acquired 4 GB reservation' in msg for msg in messages)


def test_acquire_times_out_while_waiting(monkeypatch):
    client = MagicMock()
    client.eval.return_value = 0
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: client)
    monkeypatch.setattr(gpu_slots, '_gpu_capacity_gb', lambda: 16.0)
    clock = _FakeClock()
    monkeypatch.setattr(gpu_slots.time, 'time', clock.time)
    monkeypatch.setattr(gpu_slots.time, 'sleep', clock.sleep)

    with pytest.raises(RuntimeError, match='Timed out after 2s waiting for 4 GB'):
        with gpu_memory_slot(
            {'metadata': {'gpuMemoryGB': 4, 'gpuMemoryDeclared': True}},
            acquire_timeout_seconds=2,
        ):
            pass
