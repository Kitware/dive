import copy
import json
from unittest.mock import MagicMock, patch

from girder.exceptions import AccessException, RestException
import pytest

from dive_server import crud, crud_dataset
from dive_server.crud_rpc import _get_data_by_type
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


def _source_item(name: str):
    return {'_id': f'{name}-id', 'name': name}


def _descriptor(name: str):
    return {'itemId': f'{name}-id', 'name': name}


@patch('dive_server.crud_dataset.crud_annotation.clone_annotations')
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Folder')
def test_create_single_camera_soft_clone_copies_metadata(
    folder_cls, get_clone_root_mock, _aux, _clone_ann
):
    owner = {'login': 'tester'}
    source = {
        '_id': 'source-id',
        'name': 'source-dataset',
        'meta': {
            'annotate': True,
            'type': 'image-sequence',
            'custom': {'labels': ['fish'], 'settings': {'enabled': True}},
            'typeHierarchy': {'salmon': 'fish'},
        },
    }
    parent = {'_id': 'dest-parent'}
    cloned_folder = {'_id': 'clone-id', 'name': 'Clone dataset'}
    folder_cls.return_value.createFolder.return_value = cloned_folder
    get_clone_root_mock.return_value = source

    result = crud_dataset.createSoftClone(owner, source, parent, 'Clone dataset', None)

    assert result is cloned_folder
    source['meta']['custom']['labels'].append('shark')
    source['meta']['custom']['settings']['enabled'] = False
    source['meta']['typeHierarchy']['salmon'] = 'animal'
    assert cloned_folder['meta']['custom'] == {
        'labels': ['fish'],
        'settings': {'enabled': True},
    }
    assert cloned_folder['meta']['typeHierarchy'] == {'salmon': 'fish'}

    cloned_folder['meta']['custom']['labels'].append('ray')
    cloned_folder['meta']['custom']['settings']['enabled'] = None
    cloned_folder['meta']['typeHierarchy']['tuna'] = 'fish'
    assert source['meta']['custom'] == {
        'labels': ['fish', 'shark'],
        'settings': {'enabled': False},
    }
    assert source['meta']['typeHierarchy'] == {'salmon': 'animal'}


@patch('dive_server.crud_dataset._clone_calibration_items')
@patch('dive_server.crud_dataset.crud_annotation.clone_annotations')
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Folder')
def test_create_multicam_soft_clone_preserves_only_parent_hierarchy(
    folder_cls,
    get_clone_root_mock,
    _aux,
    _clone_ann,
    clone_calibration_mock,
):
    owner = {'login': 'tester'}
    source = _multi_parent_folder()
    source['meta']['typeHierarchy'] = {'salmon': 'fish'}
    left = _child_folder('left-id', 'left')
    left['meta']['typeHierarchy'] = {'left salmon': 'fish'}
    right = _child_folder('right-id', 'right')
    right['meta']['typeHierarchy'] = {'right salmon': 'fish'}
    destination = {'_id': 'dest-parent'}
    cloned_parent = {'_id': 'clone-parent-id', 'name': 'Clone stereo'}
    cloned_left = {'_id': 'clone-left-id', 'name': 'left'}
    cloned_right = {'_id': 'clone-right-id', 'name': 'right'}
    folder_cls.return_value.createFolder.side_effect = [
        cloned_parent,
        cloned_left,
        cloned_right,
    ]
    folder_cls.return_value.load.side_effect = lambda folder_id, **_kwargs: {
        'left-id': left,
        'right-id': right,
    }[folder_id]
    get_clone_root_mock.side_effect = lambda _owner, source_folder: source_folder
    clone_calibration_mock.side_effect = lambda _owner, _source, _cloned, multi_cam: multi_cam

    result = crud_dataset.createSoftClone(owner, source, destination, 'Clone stereo', None)

    assert result is cloned_parent
    assert cloned_parent['meta']['typeHierarchy'] == {'salmon': 'fish'}
    assert 'typeHierarchy' not in cloned_left['meta']
    assert 'typeHierarchy' not in cloned_right['meta']
    cameras = cloned_parent['meta'][constants.MultiCamMarker]['cameras']
    assert cameras['left']['folderId'] == 'clone-left-id'
    assert cameras['right']['folderId'] == 'clone-right-id'

    source['meta']['typeHierarchy']['salmon'] = 'animal'
    left['meta']['typeHierarchy']['left tuna'] = 'fish'
    right['meta']['typeHierarchy']['right salmon'] = 'animal'
    assert cloned_parent['meta']['typeHierarchy'] == {'salmon': 'fish'}
    assert 'typeHierarchy' not in cloned_left['meta']
    assert 'typeHierarchy' not in cloned_right['meta']


@patch('dive_server.crud_dataset.find_json_calibration_item_id', return_value=None)
@patch('dive_server.crud_dataset.find_calibration_item_id', return_value=None)
@patch('dive_server.crud_dataset.crud_annotation.clone_annotations')
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset._create_single_camera_soft_clone')
@patch('dive_server.crud_dataset.Folder')
def test_create_multicam_soft_clone_rewrites_camera_folder_ids(
    folder_cls, create_soft_clone_mock, _aux, _clone_ann, _find_cal, _find_json_cal
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


@patch('dive_server.crud_dataset._clone_calibration_items')
@patch('dive_server.crud_dataset.crud_annotation.clone_annotations')
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset._create_single_camera_soft_clone')
@patch('dive_server.crud_dataset.Folder')
def test_create_multicam_soft_clone_copies_calibration(
    folder_cls,
    create_soft_clone_mock,
    _aux,
    _clone_ann,
    clone_cals_mock,
):
    owner = {'login': 'tester'}
    source = _multi_parent_folder()
    source['meta'][constants.MultiCamMarker][constants.CalibrationItemIdMarker] = 'cal-src'
    source['meta'][constants.MultiCamMarker][constants.JsonCalibrationItemIdMarker] = 'cal-json'
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
    clone_cals_mock.side_effect = lambda _owner, _source, _cloned, multi_cam: {
        **multi_cam,
        constants.CalibrationItemIdMarker: 'new-cal-src',
        constants.JsonCalibrationItemIdMarker: 'new-cal-json',
    }

    crud_dataset.createSoftClone(owner, source, parent, 'Clone stereo', None)

    clone_cals_mock.assert_called_once()
    saved_meta = folder_cls.return_value.save.call_args_list[-1][0][0]['meta']
    assert saved_meta[constants.MultiCamMarker][constants.CalibrationItemIdMarker] == 'new-cal-src'
    assert (
        saved_meta[constants.MultiCamMarker][constants.JsonCalibrationItemIdMarker]
        == 'new-cal-json'
    )


@patch('dive_server.crud_dataset.find_json_calibration_item_id', return_value=None)
@patch('dive_server.crud_dataset.find_calibration_item_id', return_value=None)
@patch('dive_server.crud_dataset.crud_annotation.clone_annotations')
@patch('dive_server.crud_dataset.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_dataset._create_single_camera_soft_clone')
@patch('dive_server.crud_dataset.Item')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud.Folder')
def test_multicam_soft_clone_preserves_shared_parent_frame_metadata_source(
    crud_folder_cls,
    folder_cls,
    item_cls,
    create_soft_clone_mock,
    _aux,
    _clone_ann,
    _find_cal,
    _find_json_cal,
):
    owner = {'login': 'tester'}
    source = _multi_parent_folder()
    source['meta'][constants.MetadataFileItemIdMarker] = 'shared-id'
    source['meta'][constants.MetadataFileOriginalNameMarker] = 'flight-log.csv'
    parent = {'_id': 'dest-parent'}
    left = _child_folder('left-id', 'left')
    right = _child_folder('right-id', 'right')
    cloned_left = {
        **copy.deepcopy(left),
        '_id': 'clone-left-id',
        constants.ForeignMediaIdMarker: 'left-id',
    }
    cloned_right = {
        **copy.deepcopy(right),
        '_id': 'clone-right-id',
        constants.ForeignMediaIdMarker: 'right-id',
    }
    cloned_parent = copy.deepcopy(source)
    cloned_parent['_id'] = 'clone-parent-id'

    folder_model = folder_cls.return_value
    folder_model.createFolder.return_value = cloned_parent
    folders_by_id = {
        'parent-id': source,
        'left-id': left,
        'right-id': right,
        'clone-left-id': cloned_left,
        'clone-right-id': cloned_right,
    }
    folder_model.load.side_effect = lambda folder_id, **kwargs: folders_by_id.get(folder_id)
    crud_folder_cls.return_value.load.side_effect = lambda folder_id, **kwargs: folders_by_id.get(
        folder_id
    )
    item_cls.return_value.load.return_value = {
        '_id': 'shared-id',
        'folderId': 'parent-id',
        'name': 'stored.csv',
    }
    # filters is the server-side sidecar pre-filter; the mock ignores it and returns the
    # full per-folder list so the is_declared post-filter still decides membership.
    folder_model.childItems.side_effect = lambda folder, filters=None: {
        'parent-id': [],
        'clone-parent-id': [],
        'left-id': [],
        'right-id': [],
        'clone-left-id': [],
        'clone-right-id': [],
    }.get(folder['_id'], [])
    create_soft_clone_mock.side_effect = [cloned_left, cloned_right]

    result = crud_dataset.createSoftClone(owner, source, parent, 'Clone stereo', None)
    sources = crud_dataset.load_frame_metadata_sources(result, owner)

    assert sources == {
        'shared': {'itemId': 'shared-id', 'name': 'flight-log.csv'},
        'cameras': {},
    }


@patch('dive_server.crud_dataset._yield_single_dataset_export')
@patch('dive_server.crud_dataset._yield_calibration_files')
@patch('dive_server.crud_dataset.get_multi_cam_media')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.ziputil.ZipGenerator')
def test_export_multicam_zip_includes_multicam_json_and_cameras(
    zip_gen_cls,
    folder_cls,
    get_multi_cam_media_mock,
    yield_cal_mock,
    yield_single_mock,
):
    parent = _multi_parent_folder()
    left = _child_folder('left-id', 'left')
    right = _child_folder('right-id', 'right')
    user = {'login': 'tester'}
    folder_cls.return_value.load.side_effect = lambda fid, **kwargs: {
        'left-id': left,
        'right-id': right,
    }[fid]
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
    # The parent exports no media of its own, but includeMedia still reaches it so its
    # shared attachment is emitted by the one owner of that decision.
    parent_call = next(
        call for call in yield_single_mock.call_args_list if call.args[1] == './stereo-dataset/'
    )
    assert parent_call.args[4] is True
    assert folder_cls.return_value.load.call_count == 2


@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Item')
def test_yield_metadata_file_uses_original_name(item_cls, get_clone_root):
    z = MagicMock()

    def add_file_side_effect(_maker, path):
        yield str(path).encode('utf-8')

    z.addFile.side_effect = add_file_side_effect
    folder = {
        '_id': 'parent-id',
        'meta': {
            constants.MetadataFileItemIdMarker: 'md-item-id',
            constants.MetadataFileOriginalNameMarker: 'flight_log.csv',
        },
    }
    get_clone_root.return_value = folder
    item_cls.return_value.load.return_value = {
        '_id': 'md-item-id',
        'folderId': 'parent-id',
        'name': 'renamed.csv',
    }
    item_cls.return_value.fileList.return_value = [('renamed.csv', MagicMock())]

    chunks = list(
        crud_dataset._yield_metadata_file(z, './stereo-dataset/', folder, {'login': 'tester'})
    )

    z.addFile.assert_called_once()
    assert str(z.addFile.call_args.args[1]) == 'stereo-dataset/metadata/flight_log.csv'
    assert any(b'flight_log.csv' in chunk for chunk in chunks)


@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.Item')
def test_yield_metadata_file_exports_reserved_name_attachment(
    item_cls,
    folder_cls,
    get_clone_root,
):
    """An attachment discovered by reserved name survives an export/re-import round trip."""
    z = MagicMock()

    def add_file_side_effect(_maker, path):
        yield str(path).encode('utf-8')

    z.addFile.side_effect = add_file_side_effect
    folder = {'_id': 'ds-id', 'meta': {}}
    get_clone_root.return_value = folder
    reserved_item = {
        '_id': 'reserved-id',
        'folderId': 'ds-id',
        'name': 'frame_metadata.csv',
    }
    folder_cls.return_value.childItems.return_value = [reserved_item]
    item_cls.return_value.load.return_value = reserved_item
    item_cls.return_value.fileList.return_value = [('frame_metadata.csv', MagicMock())]

    list(crud_dataset._yield_metadata_file(z, './ds/', folder, {'login': 'tester'}))

    assert str(z.addFile.call_args.args[1]) == 'ds/metadata/frame_metadata.csv'


@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Item')
def test_yield_metadata_file_exports_attachment_on_an_unreadable_clone_root(
    item_cls,
    get_clone_root,
):
    """A clone root the exporter cannot read still contributes its attachment.

    getCloneRoot force-loads the source, so an access-checked item load there raises
    AccessException -- which is not a RestException, so it would escape the guard in
    export_datasets_zipstream and abort the whole stream instead of listing the dataset in
    failed_datasets.txt. The export already streams that root's media unchecked.
    """
    z = MagicMock()

    def add_file_side_effect(_maker, path):
        yield str(path).encode('utf-8')

    z.addFile.side_effect = add_file_side_effect
    folder = {'_id': 'clone-id', 'meta': {}, constants.ForeignMediaIdMarker: 'source-id'}
    source_root = {
        '_id': 'source-id',
        'meta': {
            constants.MetadataFileItemIdMarker: 'md-item-id',
            constants.MetadataFileOriginalNameMarker: 'flight_log.csv',
        },
    }
    get_clone_root.return_value = source_root

    def load_item(item_id, level=None, user=None, force=False):
        if not force:
            raise AccessException('Read access denied for folder source-id.')
        return {'_id': 'md-item-id', 'folderId': 'source-id', 'name': 'renamed.csv'}

    item_cls.return_value.load.side_effect = load_item
    item_cls.return_value.fileList.return_value = [('renamed.csv', MagicMock())]

    list(crud_dataset._yield_metadata_file(z, './ds/', folder, {'login': 'tester'}))

    assert str(z.addFile.call_args.args[1]) == 'ds/metadata/flight_log.csv'


@patch('dive_server.crud_dataset.crud.getCloneRoot')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.Item')
def test_yield_metadata_file_skips_when_unset(item_cls, folder_cls, get_clone_root):
    z = MagicMock()
    folder = {'_id': 'id', 'meta': {}}
    get_clone_root.return_value = folder
    folder_cls.return_value.childItems.return_value = []

    chunks = list(crud_dataset._yield_metadata_file(z, './ds/', folder, {'login': 'tester'}))

    assert chunks == []
    item_cls.return_value.load.assert_not_called()
    z.addFile.assert_not_called()


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
    parent['meta'][constants.MetadataFileItemIdMarker] = 'metadata-id'
    parent['meta'][constants.MetadataFileOriginalNameMarker] = 'flight_log.csv'
    parent['meta']['typeHierarchy'] = {'salmon': 'fish'}
    left = _child_folder('left-id', 'left')
    left['meta']['typeHierarchy'] = {'left salmon': 'fish'}
    right = _child_folder('right-id', 'right')
    right['meta']['typeHierarchy'] = {}
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

    def get_dataset(folder, _user):
        data = {'id': folder['_id'], 'type': folder['meta']['type']}
        if 'typeHierarchy' in folder['meta']:
            data['typeHierarchy'] = folder['meta']['typeHierarchy']
        if constants.MetadataFileItemIdMarker in folder['meta']:
            data[constants.MetadataFileItemIdMarker] = folder['meta'][
                constants.MetadataFileItemIdMarker
            ]
            data[constants.MetadataFileOriginalNameMarker] = folder['meta'][
                constants.MetadataFileOriginalNameMarker
            ]
        return MagicMock(dict=lambda exclude_none=True: data)

    get_dataset_mock.side_effect = get_dataset
    get_media_mock.return_value = MagicMock(
        dict=lambda exclude_none=True: {'imageData': [], 'video': None}
    )
    get_annotations_mock.return_value = {'tracks': {}, 'groups': {}}
    csv_gen_mock.return_value = (None, iter(['# header\n']))
    get_clone_root_mock.side_effect = lambda _user, folder: folder
    valid_images_mock.return_value = [{'_id': 'img1', 'name': 'left.png'}]
    item_cls.return_value.fileList.return_value = [('left.png', MagicMock())]
    item_cls.return_value.load.return_value = {
        '_id': 'metadata-id',
        'folderId': 'parent-id',
        'name': 'renamed.csv',
    }

    def load_folder(folder_id, level=None, user=None):
        return {'left-id': left, 'right-id': right}.get(folder_id)

    folder_cls.return_value.load.side_effect = load_folder

    def child_items(folder, filters=None, **kwargs):
        # The reserved-name query is an $in over basenames; the media walk is a $regex.
        if '$in' in (filters or {}).get('lowerName', {}):
            return []
        return [{'_id': 'img-item', 'name': 'left.png'}]

    folder_cls.return_value.childItems.side_effect = child_items

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

    assert 'stereo-dataset/multiCam.json' in zip_entries
    assert 'stereo-dataset/config.json' in zip_entries
    assert 'stereo-dataset/left/config.json' in zip_entries
    assert 'stereo-dataset/right/config.json' in zip_entries
    multi_cam = json.loads(zip_entries['stereo-dataset/multiCam.json'].decode())
    assert multi_cam['defaultDisplay'] == 'left'
    parent_config = json.loads(zip_entries['stereo-dataset/config.json'].decode())
    # The archive carries no attachment locator at all -- neither the server-local item id
    # nor the name -- because it is discovered at metadata/<originalName>. Same key set the
    # desktop exporter writes (withoutMetadataAttachment in multicamExport.ts).
    assert constants.MetadataFileItemIdMarker not in parent_config
    assert constants.MetadataFileOriginalNameMarker not in parent_config
    assert 'stereo-dataset/metadata/flight_log.csv' in zip_entries
    left_config = json.loads(zip_entries['stereo-dataset/left/config.json'].decode())
    right_config = json.loads(zip_entries['stereo-dataset/right/config.json'].decode())
    assert parent_config['typeHierarchy'] == {'salmon': 'fish'}
    assert 'typeHierarchy' not in left_config
    assert 'typeHierarchy' not in right_config

    with patch('dive_server.crud_rpc.File') as file_cls:
        file_cls.return_value.download.return_value = lambda: [
            zip_entries['stereo-dataset/config.json']
        ]
        imported, warnings = _get_data_by_type(
            {'_id': 'file-id', 'name': 'config.json', 'exts': ['json']}
        )
    assert warnings is None
    assert imported['type'] == crud.FileType.DIVE_CONF
    assert imported['meta']['typeHierarchy'] == {'salmon': 'fish'}


@patch('dive_server.crud_dataset.ziputil.ZipGenerator')
def test_export_zip_preflights_invalid_hierarchy_before_archive_header(zip_gen_cls):
    folder = {
        '_id': 'dataset-id',
        'name': 'dataset',
        'meta': {
            'annotate': True,
            'type': constants.VideoType,
            'fps': 5,
            'typeHierarchy': {'fish': 'fish'},
        },
    }

    with pytest.raises(RestException) as error_info:
        crud_dataset.export_datasets_zipstream(
            [folder],
            {'_id': 'user-id'},
            includeMedia=True,
            includeDetections=True,
            excludeBelowThreshold=False,
            typeFilter=None,
        )

    assert str(error_info.value) == (
        'Type hierarchy is invalid: self edge "fish -> fish". '
        'No configuration file was exported.'
    )
    zip_gen_cls.assert_not_called()

    folder['meta']['typeHierarchy'] = {'salmon': 'fish'}
    zip_gen_cls.return_value.footer.return_value = b'footer'
    with (
        patch('dive_server.crud_dataset.get_media') as get_media_mock,
        patch(
            'dive_server.crud_dataset._yield_single_dataset_export',
            return_value=iter([b'config-entry']),
        ),
    ):
        get_media_mock.return_value = MagicMock()
        retry = crud_dataset.export_datasets_zipstream(
            [folder],
            {'_id': 'user-id'},
            includeMedia=True,
            includeDetections=True,
            excludeBelowThreshold=False,
            typeFilter=None,
        )
        chunks = list(retry())

    assert chunks == [b'config-entry', b'footer']
    zip_gen_cls.assert_called_once()


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

    assert 'stereo-dataset/multiCam.json' in paths
    assert 'stereo-dataset/left/annotations.viame.csv' in paths
    assert 'stereo-dataset/right/annotations.viame.csv' in paths
    assert csv_gen_mock.call_count == 2


@patch('dive_server.crud_dataset.ziputil.ZipGenerator')
def test_export_multicam_annotations_preflights_invalid_coco_hierarchy(zip_gen_cls):
    parent = _multi_parent_folder()
    parent['meta']['typeHierarchy'] = {'fish': 'fish'}

    with pytest.raises(RestException) as error_info:
        crud_dataset.export_multicam_annotations_zipstream(
            parent,
            {'login': 'tester'},
            'coco_json',
            False,
            None,
            None,
        )

    assert str(error_info.value) == (
        'Type hierarchy is invalid: self edge "fish -> fish". ' 'No COCO file was exported.'
    )
    zip_gen_cls.assert_not_called()
