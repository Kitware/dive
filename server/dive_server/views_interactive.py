"""Server-side interactive segmentation and stereo for the web client.

Each request names a dataset, camera and frame; girder resolves them to the
assetstore paths the VIAME interactive service reads, checks that the GPU is
not held by a job, and forwards the command to the broker on the GPU host.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional, Tuple

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.folder import Folder
import requests

from dive_server import crud, interactive_gate, interactive_media
from dive_utils import constants, fromMeta, types

STEREO_METHODS = ('ncc', 'dino', 'foundation')
REQUEST_TIMEOUT = 320


class InteractiveClient:
    """Talks to the broker; one session per user and dataset."""

    def __init__(self) -> None:
        # Stereo backends are enabled once per session generation and method.
        self._stereo_ready: Dict[str, Tuple[int, str, Optional[str]]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def session_key(user: types.GirderUserModel, dsFolder: types.GirderModel) -> str:
        return f"{user['_id']}-{dsFolder['_id']}"

    def request(
        self,
        key: str,
        command: str,
        params: Dict[str, Any],
        session: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = interactive_gate.require_interactive_available()
        try:
            response = requests.post(
                f'{url}/sessions/{key}/request',
                json={'command': command, 'params': params, 'session': session or {}},
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as err:
            raise RestException(f'The interactive service is unreachable: {err}', code=503)
        body: Dict[str, Any] = {}
        try:
            body = response.json()
        except ValueError:
            pass
        if response.status_code == 503:
            raise RestException(body.get('error') or 'The interactive service is busy.', code=503)
        if response.status_code >= 400:
            raise RestException(body.get('error') or 'The interactive service failed.', code=502)
        return body

    def ensure_stereo(
        self,
        key: str,
        method: str,
        calibration: Optional[str],
        generation_hint: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Enable the session's stereo backend for `method`, once per process."""
        with self._lock:
            ready = self._stereo_ready.get(key)
        if ready and generation_hint is not None and ready == (generation_hint, method, calibration):
            return {'_session': {'generation': generation_hint}}
        params: Dict[str, Any] = {}
        if calibration:
            params['calibration_file'] = calibration
        response = self.request(key, 'enable', params, session={'stereoMethod': method})
        generation = int((response.get('_session') or {}).get('generation') or 0)
        with self._lock:
            self._stereo_ready[key] = (generation, method, calibration)
        return response

    def generation(self, key: str) -> Optional[int]:
        with self._lock:
            ready = self._stereo_ready.get(key)
        return ready[0] if ready else None

    def forget(self, key: str) -> None:
        with self._lock:
            self._stereo_ready.pop(key, None)


client = InteractiveClient()


def _method(value: Optional[str]) -> str:
    return value if value in STEREO_METHODS else 'ncc'


def _bad(response: Dict[str, Any], fallback: str) -> RestException:
    return RestException(response.get('error') or fallback, code=400)


class InteractiveResource(Resource):
    def __init__(self, resourceName: str):
        super().__init__()
        self.resourceName = resourceName
        self.route('GET', ('status',), self.status)
        self.route('POST', ('segmentation', 'predict'), self.segmentation_predict)
        self.route('POST', ('segmentation', 'keypoints'), self.segmentation_keypoints)
        self.route('POST', ('segmentation', 'stereo_segment'), self.segmentation_stereo_segment)
        self.route('POST', ('text_query',), self.text_query)
        self.route('POST', ('stereo', 'set_frame'), self.stereo_set_frame)
        self.route('POST', ('stereo', 'transfer_points'), self.stereo_transfer_points)
        self.route('POST', ('stereo', 'transfer_line'), self.stereo_transfer_line)
        self.route('POST', ('stereo', 'measure_line'), self.stereo_measure_line)
        self.route('POST', ('stereo', 'aggregate_lengths'), self.stereo_aggregate_lengths)
        self.route('DELETE', ('session',), self.end_session)

    # ---- helpers -----------------------------------------------------------

    def _dataset(self, dataset_id: str) -> Tuple[types.GirderModel, types.GirderUserModel]:
        user = self.getCurrentUser()
        folder = Folder().load(dataset_id, level=AccessType.READ, user=user)
        if folder is None:
            raise RestException('Dataset not found', code=404)
        crud.verify_dataset(folder)
        return folder, user

    def _stereo_pair(
        self, folder: types.GirderModel, user: types.GirderUserModel, frame: int
    ) -> Tuple[List[str], Dict[str, Any], Dict[str, Any]]:
        cameras = interactive_media.camera_order(folder)
        if len(cameras) < 2:
            raise RestException('Stereo tools need a two-camera dataset', code=400)
        left = interactive_media.resolve_frame(folder, cameras[0], frame, user)
        right = interactive_media.resolve_frame(folder, cameras[1], frame, user)
        return cameras, left, right

    def _stereo_session(
        self, folder: types.GirderModel, user: types.GirderUserModel, method: str
    ) -> str:
        key = client.session_key(user, folder)
        calibration = interactive_media.calibration_path(folder, user)
        client.ensure_stereo(key, method, calibration, client.generation(key))
        return key

    def _stereo_request(
        self, key: str, method: str, command: str, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        response = client.request(key, command, params, session={'stereoMethod': method})
        # A restarted process lost its stereo backend: enable it again and retry once.
        generation = int((response.get('_session') or {}).get('generation') or 0)
        if not response.get('success', True) and client.generation(key) not in (None, generation):
            client.forget(key)
            raise RestException('The interactive session restarted; retry the request.', code=503)
        return response

    # ---- routes ------------------------------------------------------------

    @access.user
    @autoDescribeRoute(Description('Whether server-side interactive tools can be used now'))
    def status(self):
        return interactive_gate.get_interactive_capability()

    @access.user
    @autoDescribeRoute(
        Description('Segment one frame from point and box prompts')
        .jsonParam('data', 'Request body', paramType='body', requireObject=True)
    )
    def segmentation_predict(self, data):
        folder, user = self._dataset(data['datasetId'])
        media = interactive_media.resolve_frame(folder, data.get('camera'), int(data['frame']), user)
        params: Dict[str, Any] = {
            'image_path': media['path'],
            'points': data.get('points') or [],
            'point_labels': data.get('pointLabels') or [],
        }
        if media['frameTime'] is not None:
            params['frame_time'] = media['frameTime']
        for name, key in (('box', 'box'), ('line', 'line'), ('multimaskOutput', 'multimask_output')):
            if data.get(name) is not None:
                params[key] = data[name]
        return client.request(client.session_key(user, folder), 'predict', params)

    @access.user
    @autoDescribeRoute(
        Description('Head and tail points of a mask polygon')
        .jsonParam('data', 'Request body', paramType='body', requireObject=True)
    )
    def segmentation_keypoints(self, data):
        folder, user = self._dataset(data['datasetId'])
        params = {k: data[k] for k in ('polygon', 'polygons') if data.get(k) is not None}
        return client.request(client.session_key(user, folder), 'polygon_keypoints', params)

    @access.user
    @autoDescribeRoute(
        Description('Carry a source-camera mask to the other stereo camera')
        .jsonParam('data', 'Request body', paramType='body', requireObject=True)
    )
    def segmentation_stereo_segment(self, data):
        folder, user = self._dataset(data['datasetId'])
        frame = int(data['frame'])
        method = _method(data.get('method'))
        cameras, left, right = self._stereo_pair(folder, user, frame)
        source = data.get('sourceCamera') or cameras[0]
        if source not in cameras:
            raise RestException(f'Unknown camera "{source}"', code=400)
        source_is_left = source == cameras[0]
        key = self._stereo_session(folder, user, method)
        params: Dict[str, Any] = {
            'points': data.get('points') or [],
            'point_labels': data.get('pointLabels') or [],
            'source_camera': 'left' if source_is_left else 'right',
            'source_image_path': (left if source_is_left else right)['path'],
            'other_image_path': (right if source_is_left else left)['path'],
        }
        calibration = interactive_media.calibration_path(folder, user)
        if calibration:
            params['calibration_file'] = calibration
        if left['frameTime'] is not None:
            params['frame_time'] = left['frameTime']
        for name in ('polygon', 'polygons'):
            if data.get(name) is not None:
                params[name] = data[name]
        return self._stereo_request(key, method, 'stereo_segment', params)

    @access.user
    @autoDescribeRoute(
        Description('Find every instance of a text prompt in one frame')
        .jsonParam('data', 'Request body', paramType='body', requireObject=True)
    )
    def text_query(self, data):
        folder, user = self._dataset(data['datasetId'])
        media = interactive_media.resolve_frame(folder, data.get('camera'), int(data['frame']), user)
        params: Dict[str, Any] = {'image_path': media['path'], 'text': str(data.get('text') or '')}
        if media['frameTime'] is not None:
            params['frame_time'] = media['frameTime']
        return client.request(client.session_key(user, folder), 'text_query', params)

    @access.user
    @autoDescribeRoute(
        Description('Prepare a stereo frame pair (dense disparity ahead of warps)')
        .jsonParam('data', 'Request body', paramType='body', requireObject=True)
    )
    def stereo_set_frame(self, data):
        folder, user = self._dataset(data['datasetId'])
        method = _method(data.get('method'))
        _cameras, left, right = self._stereo_pair(folder, user, int(data['frame']))
        key = self._stereo_session(folder, user, method)
        params: Dict[str, Any] = {'left_image_path': left['path'], 'right_image_path': right['path']}
        if left['frameTime'] is not None:
            params['frame_time'] = left['frameTime']
        return self._stereo_request(key, method, 'set_frame', params)

    def _stereo_frame_params(self, data) -> Tuple[str, str, Dict[str, Any], List[str]]:
        folder, user = self._dataset(data['datasetId'])
        method = _method(data.get('method'))
        cameras, left, right = self._stereo_pair(folder, user, int(data['frame']))
        key = self._stereo_session(folder, user, method)
        params: Dict[str, Any] = {'left_image_path': left['path'], 'right_image_path': right['path']}
        if left['frameTime'] is not None:
            params['frame_time'] = left['frameTime']
        return key, method, params, cameras

    @access.user
    @autoDescribeRoute(
        Description('Warp points from one stereo camera to the other')
        .jsonParam('data', 'Request body', paramType='body', requireObject=True)
    )
    def stereo_transfer_points(self, data):
        key, method, params, cameras = self._stereo_frame_params(data)
        source = data.get('sourceCamera') or cameras[0]
        if source not in cameras:
            raise RestException(f'Unknown camera "{source}"', code=400)
        params.update({
            'points': data.get('points') or [],
            'source_camera': 'left' if source == cameras[0] else 'right',
            'strict': bool(data.get('strict', True)),
        })
        return self._stereo_request(key, method, 'transfer_points', params)

    @access.user
    @autoDescribeRoute(
        Description('Warp a head/tail line to the other camera and measure it')
        .jsonParam('data', 'Request body', paramType='body', requireObject=True)
    )
    def stereo_transfer_line(self, data):
        key, method, params, _cameras = self._stereo_frame_params(data)
        params['line'] = data.get('line') or []
        return self._stereo_request(key, method, 'transfer_line', params)

    @access.user
    @autoDescribeRoute(
        Description('Measure a line drawn on both cameras')
        .jsonParam('data', 'Request body', paramType='body', requireObject=True)
    )
    def stereo_measure_line(self, data):
        key, method, params, _cameras = self._stereo_frame_params(data)
        params.update({'left_line': data.get('leftLine') or [], 'right_line': data.get('rightLine') or []})
        return self._stereo_request(key, method, 'measure_line', params)

    @access.user
    @autoDescribeRoute(
        Description('Combine per-frame lengths into one track length')
        .jsonParam('data', 'Request body', paramType='body', requireObject=True)
    )
    def stereo_aggregate_lengths(self, data):
        folder, user = self._dataset(data['datasetId'])
        params = {'lengths': data.get('lengths') or []}
        if data.get('method'):
            params['method'] = data['method']
        return client.request(client.session_key(user, folder), 'aggregate_lengths', params)

    @access.user
    @autoDescribeRoute(
        Description('End this user\'s interactive session for a dataset')
        .param('datasetId', 'Dataset id', required=True)
    )
    def end_session(self, datasetId):
        folder, user = self._dataset(datasetId)
        key = client.session_key(user, folder)
        client.forget(key)
        url = interactive_gate.broker_url()
        if url:
            try:
                requests.delete(f'{url}/sessions/{key}', timeout=5)
            except requests.RequestException:
                pass
        return {'ok': True}
