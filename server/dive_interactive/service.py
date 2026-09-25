"""One VIAME interactive_service process, spoken to over stdin/stdout."""

from __future__ import annotations

import json
import logging
import subprocess
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional

logger = logging.getLogger(__name__)

READY_MARKER = 'Service started, waiting for requests'


class ServiceError(RuntimeError):
    pass


class InteractiveProcess:
    """Spawns the service and matches its responses to requests by id.

    The service answers one line per request but not in order: some stereo
    replies arrive later from its background threads, and `set_frame` later
    emits events that reuse the request's id. A reply for an id nobody is
    waiting on is kept as an event.
    """

    def __init__(
        self,
        command: List[str] | str,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        ready_timeout: float = 300.0,
        shell: bool = False,
    ):
        self.command = command
        self.cwd = cwd
        self.env = env
        self.ready_timeout = ready_timeout
        self.shell = shell
        self.process: Optional[subprocess.Popen[str]] = None
        self.ready = threading.Event()
        self.exited = threading.Event()
        self.stderr_tail: Deque[str] = deque(maxlen=40)
        self.events: List[Dict[str, Any]] = []
        self._pending: Dict[str, Dict[str, Any]] = {}
        self._waiters: Dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._counter = 0

    def start(self) -> None:
        self.process = subprocess.Popen(
            self.command,
            cwd=self.cwd,
            env=self.env,
            shell=self.shell,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()
        if not self.ready.wait(self.ready_timeout):
            self.stop()
            raise ServiceError(
                'The interactive service did not start in time. '
                + ' '.join(list(self.stderr_tail)[-5:])
            )
        if self.exited.is_set():
            raise ServiceError(
                'The interactive service exited on startup. '
                + ' '.join(list(self.stderr_tail)[-5:])
            )

    @property
    def alive(self) -> bool:
        return self.process is not None and self.process.poll() is None and not self.exited.is_set()

    def request(self, command: str, params: Dict[str, Any], timeout: float = 300.0) -> Dict[str, Any]:
        if not self.alive:
            raise ServiceError('The interactive service is not running.')
        with self._lock:
            self._counter += 1
            request_id = f'req_{int(time.time() * 1000)}_{self._counter}'
            waiter = threading.Event()
            self._waiters[request_id] = waiter
        payload = {'id': request_id, 'command': command, **params}
        line = json.dumps(payload) + '\n'
        with self._write_lock:
            assert self.process is not None and self.process.stdin is not None
            self.process.stdin.write(line)
            self.process.stdin.flush()
        if not waiter.wait(timeout):
            with self._lock:
                self._waiters.pop(request_id, None)
            raise ServiceError(f'The interactive service did not answer "{command}" in time.')
        with self._lock:
            response = self._pending.pop(request_id, None)
            self._waiters.pop(request_id, None)
        if response is None:
            raise ServiceError('The interactive service exited before answering.')
        return response

    def events_since(self, index: int) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self.events[index:])

    def stop(self) -> None:
        process = self.process
        if process is None:
            return
        try:
            if process.poll() is None and process.stdin:
                with self._write_lock:
                    process.stdin.write(json.dumps({'id': 'shutdown', 'command': 'shutdown'}) + '\n')
                    process.stdin.flush()
                process.wait(timeout=5)
        except Exception:
            pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        self._release_waiters()

    def _release_waiters(self) -> None:
        self.exited.set()
        with self._lock:
            waiters = list(self._waiters.values())
        for waiter in waiters:
            waiter.set()

    def _read_stdout(self) -> None:
        assert self.process is not None and self.process.stdout is not None
        for raw in self.process.stdout:
            raw = raw.strip()
            if not raw:
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning('interactive service wrote non-JSON: %s', raw[:200])
                continue
            with self._lock:
                request_id = message.get('id')
                waiter = self._waiters.get(request_id) if request_id else None
                if waiter is not None and request_id not in self._pending:
                    self._pending[request_id] = message
                    waiter.set()
                else:
                    self.events.append(message)
        self._release_waiters()

    def _read_stderr(self) -> None:
        assert self.process is not None and self.process.stderr is not None
        for raw in self.process.stderr:
            line = raw.rstrip()
            self.stderr_tail.append(line)
            if READY_MARKER in line:
                self.ready.set()
        self._release_waiters()
