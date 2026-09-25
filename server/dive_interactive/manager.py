"""Sessions of the interactive service, bounded so they cannot crowd the GPU.

Each session is one service process holding its models resident. The manager
caps how many exist, retires idle ones, runs one inference at a time per
process, and bounds how many inferences run at once across all of them; a
request that cannot get a turn quickly is refused rather than queued forever.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from .service import InteractiveProcess, ServiceError


class BusyError(RuntimeError):
    """The server is at its interactive capacity right now."""


@dataclass
class Session:
    key: str
    process: InteractiveProcess
    generation: int
    created: float = field(default_factory=time.monotonic)
    last_used: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock)
    inflight: int = 0
    info: Dict[str, Any] = field(default_factory=dict)

    def touch(self) -> None:
        self.last_used = time.monotonic()


class SessionManager:
    def __init__(
        self,
        spawn: Callable[[Dict[str, Any]], InteractiveProcess],
        max_sessions: int = 2,
        idle_seconds: float = 600.0,
        queue_timeout: float = 30.0,
        max_inflight: int = 1,
        request_timeout: float = 300.0,
    ):
        self._spawn = spawn
        self.max_sessions = max_sessions
        self.idle_seconds = idle_seconds
        self.queue_timeout = queue_timeout
        self.request_timeout = request_timeout
        self._sessions: Dict[str, Session] = {}
        self._lock = threading.Lock()
        self._inflight = threading.BoundedSemaphore(max_inflight)
        self._generation = 0

    # ---- lifecycle ---------------------------------------------------------

    def ensure(self, key: str, info: Optional[Dict[str, Any]] = None) -> Session:
        """The session for `key`, started if needed; evicts an idle one for room."""
        with self._lock:
            session = self._sessions.get(key)
            if session is not None and session.process.alive:
                session.touch()
                return session
            if session is not None:
                self._sessions.pop(key, None)
            if len(self._sessions) >= self.max_sessions:
                victim = self._idle_victim()
                if victim is None:
                    raise BusyError(
                        'All interactive sessions are in use; try again in a moment.'
                    )
                self._sessions.pop(victim.key, None)
                self._stop_later(victim)
            self._generation += 1
            generation = self._generation
        process = self._spawn(info or {})
        process.start()
        session = Session(key=key, process=process, generation=generation, info=dict(info or {}))
        with self._lock:
            existing = self._sessions.get(key)
            if existing is not None and existing.process.alive:
                process.stop()
                existing.touch()
                return existing
            self._sessions[key] = session
        return session

    def _idle_victim(self) -> Optional[Session]:
        idle = [s for s in self._sessions.values() if s.inflight == 0]
        if not idle:
            return None
        return min(idle, key=lambda s: s.last_used)

    @staticmethod
    def _stop_later(session: Session) -> None:
        threading.Thread(target=session.process.stop, daemon=True).start()

    def drop(self, key: str) -> None:
        with self._lock:
            session = self._sessions.pop(key, None)
        if session is not None:
            self._stop_later(session)

    def reap_idle(self, now: Optional[float] = None) -> int:
        now = time.monotonic() if now is None else now
        with self._lock:
            stale = [
                s for s in self._sessions.values()
                if s.inflight == 0 and now - s.last_used > self.idle_seconds
            ]
            for session in stale:
                self._sessions.pop(session.key, None)
        for session in stale:
            self._stop_later(session)
        return len(stale)

    def stop_all(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            session.process.stop()

    # ---- requests ----------------------------------------------------------

    def request(
        self,
        key: str,
        command: str,
        params: Dict[str, Any],
        info: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        session = self.ensure(key, info)
        if not self._inflight.acquire(timeout=self.queue_timeout):
            raise BusyError(
                'The interactive service is busy with other requests; try again in a moment.'
            )
        try:
            with self._lock:
                session.inflight += 1
            try:
                with session.lock:
                    session.touch()
                    response = session.process.request(
                        command, params, timeout or self.request_timeout
                    )
            finally:
                with self._lock:
                    session.inflight -= 1
                    session.touch()
        finally:
            self._inflight.release()
        if not session.process.alive:
            self.drop(key)
        response['_session'] = {'generation': session.generation}
        return response

    def events(self, key: str, since: int) -> Dict[str, Any]:
        with self._lock:
            session = self._sessions.get(key)
        if session is None:
            return {'events': [], 'next': since, 'generation': None}
        events = session.process.events_since(since)
        return {'events': events, 'next': since + len(events), 'generation': session.generation}

    def status(self) -> Dict[str, Any]:
        with self._lock:
            sessions = [
                {
                    'key': s.key,
                    'generation': s.generation,
                    'inflight': s.inflight,
                    'idleSeconds': round(time.monotonic() - s.last_used, 1),
                    'alive': s.process.alive,
                }
                for s in self._sessions.values()
            ]
        return {
            'sessions': sessions,
            'maxSessions': self.max_sessions,
            'idleSeconds': self.idle_seconds,
        }


__all__ = ['BusyError', 'Session', 'SessionManager', 'ServiceError']
