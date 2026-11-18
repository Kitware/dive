import threading
from unittest.mock import MagicMock

import pytest

from dive_tasks import gpu_slots
from dive_tasks.gpu_slots import GpuLeaseLostError, gpu_memory_slot


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
