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


def test_standalone_worker_runs_whole_gpu_task_uncoordinated(monkeypatch):
    """Training (reserve_all) must still run on workers without Redis."""
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: None)
    with gpu_memory_slot({}, reserve_all=True) as lost:
        assert not lost.is_set()


def test_standalone_worker_rejects_declared_pipe(monkeypatch):
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: None)
    with pytest.raises(RuntimeError, match='GIRDER_NOTIFICATION_REDIS_URL'):
        with gpu_memory_slot({'metadata': {'gpuMemoryExclusive': True, 'gpuMemoryDeclared': True}}):
            pass


def test_default_reservation_capped_at_small_gpu(monkeypatch):
    client = MagicMock()
    client.eval.return_value = 1
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: client)
    monkeypatch.setattr(gpu_slots, '_gpu_capacity_gb', lambda: 6.0)
    with gpu_memory_slot({'metadata': {'gpuMemoryGB': 8.0, 'gpuMemoryDeclared': False}}):
        pass
    # eval(script, numkeys, key, key, now, expires, reservation, capacity, member)
    assert client.eval.call_args_list[0].args[6] == 6.0


def test_declared_reservation_over_capacity_still_fails(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: client)
    monkeypatch.setattr(gpu_slots, '_gpu_capacity_gb', lambda: 6.0)
    with pytest.raises(RuntimeError, match='requests 8 GB'):
        with gpu_memory_slot({'metadata': {'gpuMemoryGB': 8.0, 'gpuMemoryDeclared': True}}):
            pass


def test_release_failure_does_not_mask_cancel(monkeypatch):
    client = MagicMock()
    client.eval.return_value = 1
    client.zrem.side_effect = ConnectionError('redis down')
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: client)
    monkeypatch.setattr(gpu_slots, '_gpu_capacity_gb', lambda: 16.0)
    with pytest.raises(CanceledError):
        with gpu_memory_slot({'metadata': {'gpuMemoryGB': 4, 'gpuMemoryDeclared': True}}):
            raise CanceledError('Job was canceled')


@pytest.mark.parametrize(
    ('image_sizes', 'video_size', 'budget'),
    [
        ([(1080, 1920)], None, 15.9),
        ([(640, 480), (1921, 1080)], None, 23.9),
        ([], (1920, 1080), 15.9),
        ([(640, 480)], (3840, 2160), 23.9),
        ([(640, 480), None], None, 23.9),
        ([], None, 23.9),
    ],
)
def test_resolution_reservation(tmp_path, monkeypatch, image_sizes, video_size, budget):
    """Carry parsed pipe tiers through to the amount charged to Redis."""
    import json

    from PIL import Image

    from dive_tasks.pipeline_discovery import extract_pipe_metadata

    pipe = tmp_path / 'sample.pipe'
    pipe.write_text(
        '# Description: Track fish\n# GPU Memory: 15.9 GB if <=1920x1080, else 23.9 GB\n'
    )
    metadata = extract_pipe_metadata(pipe)
    assert metadata['description'] == 'Track fish'
    inputs = []
    if image_sizes:
        paths = []
        for i, size in enumerate(image_sizes):
            path = tmp_path / f'{i}.png'
            if size:
                Image.new('L', size).save(path)
            paths.append(str(path))
        manifest = tmp_path / 'images.txt'
        manifest.write_text('\n'.join(paths))
        inputs.append((str(manifest), False))
    probe = MagicMock()
    monkeypatch.setattr(gpu_slots.subprocess, 'run', probe)
    if video_size:
        probe.return_value.stdout = json.dumps(
            {'streams': [{'width': video_size[0], 'height': video_size[1]}]}
        )
        inputs.append(('camera2.mp4', True))

    client = MagicMock()
    monkeypatch.setattr(gpu_slots, '_redis_client', lambda: client)
    monkeypatch.setattr(gpu_slots, '_gpu_capacity_gb', lambda: 24)
    with gpu_memory_slot({'metadata': metadata}, inputs=inputs):
        pass
    assert client.eval.call_args_list[0].args[6] == budget
