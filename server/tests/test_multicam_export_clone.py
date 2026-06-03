import copy
import json
from unittest.mock import MagicMock, patch

from dive_server import crud_dataset
from dive_utils import constants


def _join_zip_maker(maker) -> bytes:
    if not callable(maker):
        return b''
    return b''.join(
        chunk if isinstance(chunk, bytes) else chunk.encode('utf-8') for chunk in maker()
    )


def _multi_parent_folder():
    return {
        '_id': 'parent-id',
        'name': 'stereo-dataset',
        'created': '2020-01-01T00:00:00',
        'meta': {
            'annotate': True,
            'type': constants.MultiType,
            'fps': 5,
            'subType': 'stereo',
            'multiCam': {
                'defaultDisplay': 'left',
                'cameraOrder': ['left', 'right'],
                'cameras': {
                    'left': {'folderId': 'left-id', 'type': 'image-sequence'},
                    'right': {'folderId': 'right-id', 'type': 'image-sequence'},
                },
            },
        },
    }


def _child_folder(folder_id: str, name: str):
    return {
        '_id': folder_id,
        'name': name,
        'meta': {
            'annotate': True,
            'type': 'image-sequence',
            'fps': 5,
        },
    }


@patch('dive_server.crud_dataset.crud_annotation.clone_annotations')
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset._create_single_camera_soft_clone')
@patch('dive_server.crud_dataset.Folder')
def test_create_multicam_soft_clone_rewrites_camera_folder_ids(
    folder_cls, create_soft_clone_mock, _aux, _clone_ann
):
    owner = {'login': 'tester'}
    source = _multi_parent_folder()
    parent = {'_id': 'dest-parent'}
    left = _child_folder('left-id', 'left')
    right = _child_folder('right-id', 'right')

    cloned_parent = copy.deepcopy(source)
    cloned_parent['_id'] = 'clone-parent-id'

    folder_cls.return_value.createFolder.return_value = cloned_parent

    def load_folder(folder_id, level=None, user=None):
        return {'left-id': left, 'right-id': right}.get(folder_id)

    folder_cls.return_value.load.side_effect = load_folder
    create_soft_clone_mock.side_effect = [
        {**left, '_id': 'clone-left-id'},
        {**right, '_id': 'clone-right-id'},
    ]

    result = crud_dataset.createSoftClone(owner, source, parent, 'Clone stereo', None)

    assert result == cloned_parent
    assert create_soft_clone_mock.call_count == 2
    saved_meta = folder_cls.return_value.save.call_args_list[-1][0][0]['meta']
    cameras = saved_meta[constants.MultiCamMarker]['cameras']
    assert cameras['left']['folderId'] == 'clone-left-id'
    assert cameras['right']['folderId'] == 'clone-right-id'


@patch('dive_server.crud_dataset._clone_calibration_item')
@patch('dive_server.crud_dataset.find_calibration_item_id')
@patch('dive_server.crud_dataset.crud_annotation.clone_annotations')
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset._create_single_camera_soft_clone')
@patch('dive_server.crud_dataset.Folder')
def test_create_multicam_soft_clone_copies_calibration(
    folder_cls,
    create_soft_clone_mock,
    _aux,
    _clone_ann,
    find_cal_mock,
    clone_cal_mock,
):
    owner = {'login': 'tester'}
    source = _multi_parent_folder()
    source['meta'][constants.MultiCamMarker][constants.CalibrationItemIdMarker] = 'cal-id'
    parent = {'_id': 'dest-parent'}
    left = _child_folder('left-id', 'left')
    right = _child_folder('right-id', 'right')

    cloned_parent = copy.deepcopy(source)
    cloned_parent['_id'] = 'clone-parent-id'
    folder_cls.return_value.createFolder.return_value = cloned_parent
    folder_cls.return_value.load.side_effect = lambda fid, **kwargs: {
        'left-id': left,
        'right-id': right,
    }[fid]
    create_soft_clone_mock.side_effect = [
        {**left, '_id': 'clone-left-id'},
        {**right, '_id': 'clone-right-id'},
    ]
    clone_cal_mock.return_value = 'new-cal-id'

    crud_dataset.createSoftClone(owner, source, parent, 'Clone stereo', None)

    clone_cal_mock.assert_called_once()
    saved_meta = folder_cls.return_value.save.call_args_list[-1][0][0]['meta']
    assert saved_meta[constants.MultiCamMarker][constants.CalibrationItemIdMarker] == 'new-cal-id'


@patch('dive_server.crud_dataset._yield_single_dataset_export')
@patch('dive_server.crud_dataset._yield_calibration_files')
@patch('dive_server.crud_dataset.get_multi_cam_media')
@patch('dive_server.crud_dataset.ziputil.ZipGenerator')
def test_export_multicam_zip_includes_multicam_json_and_cameras(
    zip_gen_cls, get_multi_cam_media_mock, yield_cal_mock, yield_single_mock
):
    parent = _multi_parent_folder()
    user = {'login': 'tester'}
    z = MagicMock()

    def add_file_side_effect(_maker, path):
        yield str(path).encode('utf-8')

    z.addFile.side_effect = add_file_side_effect
    zip_gen_cls.return_value = z
    yield_single_mock.return_value = iter([b'camera-chunk'])
    yield_cal_mock.return_value = iter([b'cal-chunk'])
    get_multi_cam_media_mock.return_value = MagicMock()

    stream = crud_dataset.export_datasets_zipstream(
        [parent],
        user,
        includeMedia=True,
        includeDetections=True,
        excludeBelowThreshold=False,
        typeFilter=None,
    )
    chunks = list(stream())

    assert any(b'multiCam.json' in chunk for chunk in chunks)
    assert yield_single_mock.call_count >= 3
    camera_paths = [call.args[1] for call in yield_single_mock.call_args_list]
    assert './stereo-dataset/' in camera_paths
    assert './stereo-dataset/left/' in camera_paths
    assert './stereo-dataset/right/' in camera_paths
    yield_cal_mock.assert_called_once()


@patch('dive_server.crud_dataset.crud_annotation.get_annotations')
@patch('dive_server.crud_dataset.get_dataset')
@patch('dive_server.crud_dataset.get_media')
@patch('dive_server.crud_dataset.crud_annotation.get_annotation_csv_generator')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.crud.valid_images')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.ziputil.ZipGenerator')
def test_export_multicam_integration_zip_paths(
    zip_gen_cls,
    item_cls,
    folder_cls,
    valid_images_mock,
    get_clone_root_mock,
    csv_gen_mock,
    get_media_mock,
    get_dataset_mock,
    get_annotations_mock,
):
    """Build a minimal zip and assert multicam layout from export helpers."""
    parent = _multi_parent_folder()
    left = _child_folder('left-id', 'left')
    right = _child_folder('right-id', 'right')
    user = {'login': 'tester'}

    zip_entries = {}

    class RecordingZip:
        def addFile(self, maker, path):
            zip_entries[str(path)] = _join_zip_maker(maker)

            def _gen():
                yield b''

            return _gen()

        def footer(self):
            return b''

    z = RecordingZip()
    zip_gen_cls.return_value = z

    get_dataset_mock.return_value = MagicMock(
        dict=lambda exclude_none=True: {'id': 'parent-id', 'type': constants.MultiType}
    )
    get_media_mock.return_value = MagicMock(
        dict=lambda exclude_none=True: {'imageData': [], 'video': None}
    )
    get_annotations_mock.return_value = {'tracks': {}, 'groups': {}}
    csv_gen_mock.return_value = (None, iter(['# header\n']))
    get_clone_root_mock.side_effect = lambda _user, folder: folder
    valid_images_mock.return_value = [{'_id': 'img1', 'name': 'left.png'}]
    item_cls.return_value.fileList.return_value = [('left.png', MagicMock())]

    def load_folder(folder_id, level=None, user=None):
        return {'left-id': left, 'right-id': right}.get(folder_id)

    folder_cls.return_value.load.side_effect = load_folder
    folder_cls.return_value.childItems.return_value = [{'name': 'left.png'}]

    with patch('dive_server.crud_dataset.get_multi_cam_media') as get_mcm:
        get_mcm.return_value = MagicMock()
        stream = crud_dataset.export_datasets_zipstream(
            [parent],
            user,
            includeMedia=True,
            includeDetections=False,
            excludeBelowThreshold=False,
            typeFilter=None,
        )
        list(stream())

    assert './stereo-dataset/multiCam.json' in zip_entries
    assert './stereo-dataset/meta.json' in zip_entries
    assert './stereo-dataset/left/meta.json' in zip_entries
    assert './stereo-dataset/right/meta.json' in zip_entries
    multi_cam = json.loads(zip_entries['./stereo-dataset/multiCam.json'].decode())
    assert multi_cam['defaultDisplay'] == 'left'


@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud_annotation.get_annotation_csv_generator')
@patch('dive_server.crud_dataset.ziputil.ZipGenerator')
def test_export_multicam_annotations_zip_csv(zip_gen_cls, csv_gen_mock, folder_cls):
    parent = _multi_parent_folder()
    left = _child_folder('left-id', 'left')
    right = _child_folder('right-id', 'right')
    user = {'login': 'tester'}
    paths = []

    class RecordingZip:
        def addFile(self, maker, path):
            paths.append(str(path))
            content = _join_zip_maker(maker)

            def _gen():
                yield content or b'csv'

            return _gen()

        def footer(self):
            return b''

    zip_gen_cls.return_value = RecordingZip()
    folder_cls.return_value.load.side_effect = lambda fid, **kwargs: {
        'left-id': left,
        'right-id': right,
    }[fid]
    csv_gen_mock.return_value = ('ignored.csv', lambda: iter(['# viame\n']))

    stream = crud_dataset.export_multicam_annotations_zipstream(
        parent, user, 'viame_csv', False, None, None
    )
    list(stream())

    assert './stereo-dataset/multiCam.json' in paths
    assert './stereo-dataset/left/annotations.viame.csv' in paths
    assert './stereo-dataset/right/annotations.viame.csv' in paths
    assert csv_gen_mock.call_count == 2
