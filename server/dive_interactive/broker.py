"""HTTP front for the interactive sessions, run on the GPU host.

    POST   /sessions/<key>/request   {"command", "params", "timeout"?}
    GET    /sessions/<key>/events?since=N
    DELETE /sessions/<key>
    GET    /health

Configuration comes from the environment:
    VIAME_INSTALL_PATH                  VIAME install (default /opt/noaa/viame)
    ADDON_ROOT_DIR                      extracted add-ons (default /tmp/addons/extracted)
    DIVE_INTERACTIVE_PORT               listen port (default 8800)
    DIVE_INTERACTIVE_MAX_SESSIONS       resident service processes (default 2)
    DIVE_INTERACTIVE_IDLE_SECONDS       retire a session idle this long (default 600)
    DIVE_INTERACTIVE_QUEUE_TIMEOUT      seconds a request may wait for a turn (default 30)
    DIVE_INTERACTIVE_MAX_INFLIGHT       inferences running at once (default 1)
    DIVE_INTERACTIVE_DEVICE             cuda | cpu | auto (default cuda)
    DIVE_INTERACTIVE_SEGMENTATION_CONFIG  explicit segmenter config path (optional)
"""

from __future__ import annotations

import json
import logging
import os
import shlex
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from .manager import BusyError, ServiceError, SessionManager
from .service import InteractiveProcess

logger = logging.getLogger('dive_interactive')

# Stereo configs per client method, the desktop's STEREO_METHOD_FILES.
STEREO_CONFIGS = {
    'foundation': 'interactive_stereo_fast_fdn_stereo.conf',
    'dino': 'interactive_stereo_ncc_dino.conf',
    'ncc': 'interactive_stereo_template.conf',
}
SEGMENTATION_CONFIGS = [
    'interactive_segmenter_sam2.conf',
    'interactive_segmenter_sam3.conf',
    'interactive_segmenter_default.conf',
]
TEXT_QUERY_CONFIG = 'interactive_text_query_sam3.conf'


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


class Launcher:
    """Builds the command for one service process from the install layout."""

    def __init__(self) -> None:
        self.viame = Path(os.environ.get('VIAME_INSTALL_PATH', '/opt/noaa/viame'))
        addon_root = Path(os.environ.get('ADDON_ROOT_DIR', '/tmp/addons/extracted'))
        # Add-ons unpack into their own tree, which the service's own
        # auto-discovery never looks at, so configs are found here explicitly.
        self.pipeline_dirs = [addon_root / 'configs' / 'pipelines', self.viame / 'configs' / 'pipelines']
        self.device = os.environ.get('DIVE_INTERACTIVE_DEVICE', 'cuda')

    def find_config(self, name: str) -> Optional[Path]:
        for directory in self.pipeline_dirs:
            candidate = directory / name
            if candidate.is_file():
                return candidate
        return None

    def segmentation_configs(self) -> List[Path]:
        explicit = os.environ.get('DIVE_INTERACTIVE_SEGMENTATION_CONFIG')
        configs: List[Path] = []
        if explicit:
            configs.append(Path(explicit))
        else:
            for name in SEGMENTATION_CONFIGS:
                found = self.find_config(name)
                if found:
                    configs.append(found)
                    break
        text_query = self.find_config(TEXT_QUERY_CONFIG)
        if text_query:
            configs.append(text_query)
        return configs

    def stereo_config(self, method: str) -> Optional[Path]:
        name = STEREO_CONFIGS.get(method, STEREO_CONFIGS['ncc'])
        return self.find_config(name) or self.find_config('interactive_stereo_default.conf')

    def capabilities(self) -> Dict[str, Any]:
        return {
            'segmentation': [str(c) for c in self.segmentation_configs()],
            'stereoMethods': [m for m in STEREO_CONFIGS if self.find_config(STEREO_CONFIGS[m])],
            'textQuery': self.find_config(TEXT_QUERY_CONFIG) is not None,
        }

    def spawn(self, info: Dict[str, Any]) -> InteractiveProcess:
        parts = [
            'python', '-s', '-m', 'viame.core.interactive_service',
            '--viame-path', str(self.viame),
            '--device', self.device,
        ]
        for config in self.segmentation_configs():
            parts += ['--segmentation-config', str(config)]
        stereo = self.stereo_config(str(info.get('stereoMethod', 'ncc')))
        if stereo:
            parts += ['--stereo-config', str(stereo)]
        setup = self.viame / 'setup_viame.sh'
        command = f'. {shlex.quote(str(setup))} && exec {" ".join(shlex.quote(p) for p in parts)}'
        env = dict(os.environ)
        gpu = os.environ.get('WORKER_GPU_UUID')
        if gpu:
            env['CUDA_VISIBLE_DEVICES'] = gpu
        return InteractiveProcess(
            ['bash', '-c', command],
            cwd=str(self.viame),
            env=env,
            ready_timeout=_env_float('DIVE_INTERACTIVE_READY_TIMEOUT', 300.0),
        )


def build_manager(launcher: Optional[Launcher] = None) -> SessionManager:
    launcher = launcher or Launcher()
    return SessionManager(
        spawn=launcher.spawn,
        max_sessions=_env_int('DIVE_INTERACTIVE_MAX_SESSIONS', 2),
        idle_seconds=_env_float('DIVE_INTERACTIVE_IDLE_SECONDS', 600.0),
        queue_timeout=_env_float('DIVE_INTERACTIVE_QUEUE_TIMEOUT', 30.0),
        max_inflight=_env_int('DIVE_INTERACTIVE_MAX_INFLIGHT', 1),
        request_timeout=_env_float('DIVE_INTERACTIVE_REQUEST_TIMEOUT', 300.0),
    )


def make_handler(manager: SessionManager, launcher: Launcher):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'DiveInteractive/1'

        def log_message(self, fmt: str, *args: Any) -> None:  # quieter than the default
            logger.debug(fmt, *args)

        def _send(self, status: int, body: Dict[str, Any]) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _read_json(self) -> Dict[str, Any]:
            length = int(self.headers.get('Content-Length') or 0)
            raw = self.rfile.read(length) if length else b''
            return json.loads(raw or b'{}')

        def _session_key(self) -> Optional[str]:
            parts = urlparse(self.path).path.strip('/').split('/')
            if len(parts) >= 2 and parts[0] == 'sessions' and parts[1]:
                return parts[1]
            return None

        def do_GET(self) -> None:  # noqa: N802
            url = urlparse(self.path)
            if url.path == '/health':
                self._send(200, {'ok': True, **manager.status(), **launcher.capabilities()})
                return
            key = self._session_key()
            if key and url.path.endswith('/events'):
                since = int(parse_qs(url.query).get('since', ['0'])[0] or 0)
                self._send(200, manager.events(key, since))
                return
            self._send(404, {'error': 'not found'})

        def do_POST(self) -> None:  # noqa: N802
            key = self._session_key()
            if not key or not urlparse(self.path).path.endswith('/request'):
                self._send(404, {'error': 'not found'})
                return
            try:
                body = self._read_json()
                command = str(body.get('command') or '')
                if not command:
                    self._send(400, {'error': 'command is required'})
                    return
                response = manager.request(
                    key,
                    command,
                    dict(body.get('params') or {}),
                    info=dict(body.get('session') or {}),
                    timeout=body.get('timeout'),
                )
                self._send(200, response)
            except BusyError as err:
                self._send(503, {'error': str(err), 'busy': True})
            except ServiceError as err:
                self._send(502, {'error': str(err)})
            except Exception as err:  # noqa: BLE001
                logger.exception('interactive request failed')
                self._send(500, {'error': str(err)})

        def do_DELETE(self) -> None:  # noqa: N802
            key = self._session_key()
            if not key:
                self._send(404, {'error': 'not found'})
                return
            manager.drop(key)
            self._send(200, {'ok': True})

    return Handler


def serve(port: Optional[int] = None) -> None:
    logging.basicConfig(level=os.environ.get('DIVE_INTERACTIVE_LOG_LEVEL', 'INFO'))
    launcher = Launcher()
    manager = build_manager(launcher)

    def reaper() -> None:
        while True:
            time.sleep(15)
            try:
                manager.reap_idle()
            except Exception:  # noqa: BLE001
                logger.exception('reaper failed')

    threading.Thread(target=reaper, daemon=True).start()
    server = ThreadingHTTPServer(
        ('0.0.0.0', port or _env_int('DIVE_INTERACTIVE_PORT', 8800)),
        make_handler(manager, launcher),
    )
    logger.info('interactive broker listening on %s', server.server_address)
    try:
        server.serve_forever()
    finally:
        manager.stop_all()


if __name__ == '__main__':
    serve()
