import json
from unittest.mock import MagicMock, patch

from girder.exceptions import RestException, ValidationException
import pytest

from dive_server import crud, crud_dataset
from dive_server.crud_rpc import _get_data_by_type, process_items, resolve_imported_dataset_info
from dive_server.views_dataset import DatasetResource
from dive_utils import constants, models


def _stub_folder_load_and_save(folder_cls, folder):
    """Folder.load returns a deep-ish copy of meta; save returns the doc passed in."""

    def _load(*_a, **_k):
        return {
            **folder,
            'meta': dict(folder.get('meta') or {}),
        }

    folder_cls.return_value.load = MagicMock(side_effect=_load)
    folder_cls.return_value.save = MagicMock(side_effect=lambda f: f)


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_clears_time_filters_when_null(_verify, folder_cls, crud_folder_cls):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'timeFilters': [0, 100],
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    crud_dataset.update_metadata(folder, {'timeFilters': None})

    assert 'timeFilters' not in folder['meta']
    folder_cls.return_value.save.assert_called_once()


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_clears_calibration_source_when_null(_verify, folder_cls, crud_folder_cls):
    # A cleared / hand-refined calibration sends cameraRegistrationSource: null to
    # drop a stale producer stamp; exclude_none would otherwise leave it behind.
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'image-sequence',
            'cameraRegistrationSource': {'model': 'colmap-v3', 'swathe': '17'},
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    crud_dataset.update_metadata(folder, {'cameraRegistrationSource': None})

    assert 'cameraRegistrationSource' not in folder['meta']
    folder_cls.return_value.save.assert_called_once()


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_sets_time_filters(_verify, folder_cls, crud_folder_cls):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    crud_dataset.update_metadata(folder, {'timeFilters': [10, 50]})

    assert folder['meta']['timeFilters'] == [10, 50]


@pytest.mark.parametrize('incoming', [None, {}], ids=['null', 'empty'])
@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_sets_and_clears_type_hierarchy(
    _verify, folder_cls, crud_folder_cls, incoming
):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'typeHierarchy': {'salmon': 'fish'},
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    crud_dataset.update_metadata(folder, {'typeHierarchy': incoming})

    assert 'typeHierarchy' not in folder['meta']
    folder_cls.return_value.save.assert_called_once()


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_replaces_complete_type_hierarchy(_verify, folder_cls, crud_folder_cls):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'typeHierarchy': {'salmon': 'fish'},
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    crud_dataset.update_metadata(folder, {'typeHierarchy': {'orca': 'mammal'}})

    assert folder['meta']['typeHierarchy'] == {'orca': 'mammal'}
    folder_cls.return_value.save.assert_called_once()


@pytest.mark.parametrize('conflict', [False, True], ids=['merge', 'conflict'])
@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_additive_hierarchy_uses_final_refresh(
    _verify, folder_cls, crud_folder_cls, conflict
):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'confidenceFilters': {'default': 0.1},
            'typeHierarchy': {'salmon': 'fish'},
        },
    }
    fresh = {
        **folder,
        'meta': {
            **folder['meta'],
            'typeHierarchy': {
                'salmon': 'fish',
                'tuna' if conflict else 'shark': 'mammal' if conflict else 'fish',
            },
        },
    }
    crud_folder_cls.return_value.load.return_value = fresh
    folder_cls.return_value.save = MagicMock(side_effect=lambda value: value)

    payload = {
        'confidenceFilters': {'default': 0.9},
        'typeHierarchy': {'tuna': 'fish'},
    }
    if conflict:
        with pytest.raises(RestException) as error_info:
            crud_dataset.update_metadata(
                folder,
                payload,
                verify=False,
                hierarchy_mode='additive',
            )
        assert str(error_info.value) == (
            'Type hierarchy is invalid: conflicting parents for "tuna": '
            '"mammal" and "fish". No configuration was changed.'
        )
        assert folder['meta'] == fresh['meta']
        folder_cls.return_value.save.assert_not_called()
    else:
        crud_dataset.update_metadata(
            folder,
            payload,
            verify=False,
            hierarchy_mode='additive',
        )
        assert folder['meta']['typeHierarchy'] == {
            'salmon': 'fish',
            'shark': 'fish',
            'tuna': 'fish',
        }
        assert folder['meta']['confidenceFilters'] == {'default': 0.9}
        folder_cls.return_value.save.assert_called_once()


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_rejects_invalid_type_hierarchy_without_write(
    _verify, folder_cls, crud_folder_cls
):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'confidenceFilters': {'default': 0.1},
            'typeHierarchy': {'salmon': 'fish'},
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    with pytest.raises(RestException) as error_info:
        crud_dataset.update_metadata(
            folder,
            {
                'confidenceFilters': {'default': 0.9},
                'typeHierarchy': {'fish': 'fish'},
            },
        )

    assert str(error_info.value) == (
        'Type hierarchy is invalid: self edge "fish -> fish". ' 'No configuration was changed.'
    )
    assert folder['meta'] == {
        'annotate': True,
        'type': 'video',
        'confidenceFilters': {'default': 0.1},
        'typeHierarchy': {'salmon': 'fish'},
    }
    folder_cls.return_value.save.assert_not_called()


@pytest.mark.parametrize(
    ('payload', 'expected'),
    [
        ({'confidenceFilters': {'default': 0.7}}, {'broken': 5}),
        ({'typeHierarchy': None}, None),
        ({'typeHierarchy': {}}, None),
        ({'typeHierarchy': {'salmon': 'fish'}}, {'salmon': 'fish'}),
    ],
    ids=['missing-preserves', 'null-repairs', 'empty-repairs', 'replacement-repairs'],
)
@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_direct_save_matrix_with_invalid_existing_hierarchy(
    _verify, folder_cls, crud_folder_cls, payload, expected
):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'typeHierarchy': {'broken': 5},
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    crud_dataset.update_metadata(folder, payload)

    if expected is None:
        assert 'typeHierarchy' not in folder['meta']
    else:
        assert folder['meta']['typeHierarchy'] == expected
    folder_cls.return_value.save.assert_called_once()


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_invalid_input_does_not_replace_invalid_existing_hierarchy(
    _verify, folder_cls, crud_folder_cls
):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'confidenceFilters': {'default': 0.1},
            'typeHierarchy': {'broken': 5},
        },
    }
    _stub_folder_load_and_save(folder_cls, folder)
    _stub_folder_load_and_save(crud_folder_cls, folder)

    with pytest.raises(RestException) as error_info:
        crud_dataset.update_metadata(
            folder,
            {
                'confidenceFilters': {'default': 0.9},
                'typeHierarchy': ['not', 'a', 'map'],
            },
        )

    assert str(error_info.value) == (
        'Type hierarchy is invalid: expected an object. No configuration was changed.'
    )
    assert folder['meta']['confidenceFilters'] == {'default': 0.1}
    assert folder['meta']['typeHierarchy'] == {'broken': 5}
    folder_cls.return_value.save.assert_not_called()


@pytest.mark.parametrize('hierarchy', [None, {}], ids=['null', 'empty'])
@patch('dive_server.crud_rpc.File')
def test_get_data_by_type_classifies_presence_only_type_hierarchy_as_config(file_cls, hierarchy):
    file = {'_id': 'file-id', 'name': 'config.json', 'exts': ['json']}
    file_cls.return_value.download.return_value = lambda: [
        json.dumps({'typeHierarchy': hierarchy}).encode()
    ]

    result, warnings = _get_data_by_type(file)

    assert warnings is None
    assert result['type'] == crud.FileType.DIVE_CONF
    assert result['meta']['typeHierarchy'] == hierarchy


def test_metadata_mutable_does_not_classify_unrelated_json_as_config():
    assert models.MetadataMutable.is_dive_configuration({'tracks': {}, 'groups': {}}) is False


@pytest.mark.parametrize(
    'media_type',
    [
        constants.VideoType,
        constants.ImageSequenceType,
        constants.LargeImageType,
        constants.MultiType,
    ],
)
@patch('dive_server.crud_dataset.get_multi_cam_media')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_get_dataset_loads_type_hierarchy_for_each_media_type(
    _verify, get_multi_cam_media, media_type
):
    folder = {
        '_id': 'dataset-id',
        'name': 'dataset',
        'created': '2025-01-01T00:00:00',
        'meta': {
            'annotate': True,
            'type': media_type,
            'fps': 5,
            'typeHierarchy': {'salmon': 'fish'},
        },
    }
    if media_type == constants.MultiType:
        folder['meta'].update(
            {
                'subType': 'stereo',
                'multiCam': {
                    'defaultDisplay': 'left',
                    'cameras': {},
                },
            }
        )
        get_multi_cam_media.return_value = models.MultiCamMedia(
            defaultDisplay='left', cameras={}, cameraOrder=[]
        )

    loaded = crud_dataset.get_dataset(folder, {'_id': 'user-id'})

    assert loaded.type == media_type
    assert loaded.typeHierarchy == {'salmon': 'fish'}


def _unwrapped_endpoint(endpoint):
    while hasattr(endpoint, '__wrapped__'):
        endpoint = endpoint.__wrapped__
    return endpoint


def _configuration_endpoint(resource, folder):
    return _unwrapped_endpoint(DatasetResource.get_configuration)(resource, folder)


@pytest.mark.parametrize(
    ('stored', 'expected_present'),
    [
        ({'salmon': 'fish'}, True),
        ({}, False),
        (None, False),
    ],
    ids=['non-empty', 'empty', 'absent'],
)
@patch('dive_server.views_dataset.setContentDisposition')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_configuration_endpoint_includes_only_nonempty_type_hierarchy(
    _verify, _set_content_disposition, stored, expected_present
):
    folder = {
        '_id': 'dataset-id',
        'name': 'dataset',
        'created': '2025-01-01T00:00:00',
        'meta': {
            'annotate': True,
            'type': constants.VideoType,
            'fps': 5,
            **({'typeHierarchy': stored} if stored is not None else {}),
        },
    }
    resource = MagicMock()
    resource.getCurrentUser.return_value = {'_id': 'user-id'}

    configuration = json.loads(_configuration_endpoint(resource, folder))

    assert ('typeHierarchy' in configuration) is expected_present
    if expected_present:
        assert configuration['typeHierarchy'] == {'salmon': 'fish'}


@patch('dive_server.views_dataset.setContentDisposition')
@patch('dive_server.views_dataset.cherrypy.response')
def test_configuration_endpoint_rejects_invalid_stored_hierarchy_before_serialization(
    response,
    _set_content_disposition,
):
    folder = {
        '_id': 'dataset-id',
        'name': 'dataset',
        'meta': {
            'typeHierarchy': {'fish': 'fish'},
        },
    }
    resource = MagicMock()
    resource.getCurrentUser.return_value = {'_id': 'user-id'}

    result = _configuration_endpoint(resource, folder)

    assert result == (
        'Type hierarchy is invalid: self edge "fish -> fish". '
        'No configuration file was exported.'
    )
    resource.setRawResponse.assert_called_once_with()
    assert response.status == 400
    assert response.headers.__setitem__.call_args.args == ('Content-Type', 'text/plain')
    _set_content_disposition.assert_not_called()


def test_type_hierarchy_for_export_names_the_coco_artifact():
    folder = {
        '_id': 'dataset-id',
        'meta': {'typeHierarchy': {'fish': 'fish'}},
    }

    with pytest.raises(RestException) as error_info:
        crud_dataset.type_hierarchy_for_export(folder, artifact='COCO file')

    assert str(error_info.value) == (
        'Type hierarchy is invalid: self edge "fish -> fish". '
        'No COCO file was exported.'
    )


@patch('dive_server.views_dataset.setContentDisposition')
@patch('dive_server.views_dataset.cherrypy.response')
@patch('dive_server.views_dataset.crud_dataset.export_datasets_zipstream')
@patch('dive_server.views_dataset.Folder')
def test_zip_endpoint_returns_exact_invalid_hierarchy_error_before_download(
    folder_cls,
    export_zipstream,
    response,
    set_content_disposition,
):
    folder_cls.return_value.load.return_value = {'_id': 'dataset-id', 'name': 'dataset'}
    expected = (
        'Type hierarchy is invalid: self edge "fish -> fish". '
        'No configuration file was exported.'
    )
    export_zipstream.side_effect = RestException(expected)
    resource = MagicMock()
    resource.getCurrentUser.return_value = {'_id': 'user-id'}

    result = _unwrapped_endpoint(DatasetResource.export)(
        resource,
        ['dataset-id'],
        True,
        True,
        False,
        None,
    )

    assert result == expected
    resource.setRawResponse.assert_called_once_with()
    assert response.status == 400
    assert response.headers.__setitem__.call_args.args == ('Content-Type', 'text/plain')
    set_content_disposition.assert_not_called()


@patch('dive_server.crud_rpc.File')
@patch('dive_server.views_dataset.setContentDisposition')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_configuration_endpoint_export_import_roundtrip(
    _verify, _set_content_disposition, file_cls
):
    folder = {
        '_id': 'dataset-id',
        'name': 'dataset',
        'created': '2025-01-01T00:00:00',
        'meta': {
            'annotate': True,
            'type': constants.VideoType,
            'fps': 5,
            'typeHierarchy': {'salmon': 'fish'},
        },
    }
    resource = MagicMock()
    resource.getCurrentUser.return_value = {'_id': 'user-id'}
    exported = _configuration_endpoint(resource, folder)
    file_cls.return_value.download.return_value = lambda: [exported.encode()]

    imported, warnings = _get_data_by_type(
        {'_id': 'file-id', 'name': 'dataset.config.json', 'exts': ['json']}
    )

    assert warnings is None
    assert imported['type'] == crud.FileType.DIVE_CONF
    assert imported['meta']['typeHierarchy'] == {'salmon': 'fish'}


@patch('dive_server.crud.Folder')
@patch('dive_server.crud_dataset.Folder')
@patch('dive_server.crud_dataset.crud.verify_dataset')
def test_update_metadata_preserves_concurrent_convert_fields(_verify, folder_cls, crud_folder_cls):
    """Stale in-memory meta must not wipe annotate/ffprobe written by convert_video."""
    stale = {
        '_id': 'dataset-id',
        'meta': {
            'type': 'video',
            'fps': -1,
            'confidenceFilters': {'default': 0.1},
        },
    }
    db_after_convert = {
        '_id': 'dataset-id',
        'meta': {
            'type': 'video',
            'fps': 20,
            'confidenceFilters': {'default': 0.1},
            'annotate': True,
            'originalFps': 29.97,
            'ffprobe_info': {'codec_name': 'h264'},
        },
    }
    crud_folder_cls.return_value.load = MagicMock(return_value=dict(db_after_convert))
    folder_cls.return_value.save = MagicMock(side_effect=lambda f: f)

    crud_dataset.update_metadata(stale, {'datasetInfo': {'cruise': '2403'}}, verify=False)

    saved = folder_cls.return_value.save.call_args.args[0]
    assert saved['meta']['annotate'] is True
    assert saved['meta']['originalFps'] == 29.97
    assert saved['meta']['ffprobe_info']['codec_name'] == 'h264'
    assert saved['meta']['fps'] == 20
    assert saved['meta']['datasetInfo'] == {'cruise': '2403'}
    # Caller's folder dict is refreshed in place
    assert stale['meta']['annotate'] is True


def test_refresh_folder_document_replaces_stale_meta_in_place():
    folder = {'_id': 'dataset-id', 'meta': {'type': 'video'}, 'extra': 'gone'}
    fresh = {
        '_id': 'dataset-id',
        'meta': {'type': 'video', 'annotate': True},
        'name': 'bigfish',
    }
    with patch('dive_server.crud.Folder') as folder_cls:
        folder_cls.return_value.load.return_value = fresh
        crud.refresh_folder_document(folder)

    assert folder['meta']['annotate'] is True
    assert folder['name'] == 'bigfish'
    assert 'extra' not in folder


# --- datasetInfo re-import resolution ---
# process_items reconciles an imported datasetInfo with the dataset's existing block via this
# helper. The subtle, regression-prone bit is the merge direction on an additive import.


def test_resolve_imported_dataset_info_additive_imported_wins_and_preserves_existing():
    """Additive: imported values win on collision; keys absent from the file survive."""
    existing = {'cruise': '2403', 'year': '2024', 'sta_lat': '26.8195'}
    meta = {'datasetInfo': {'year': '2025', 'gfishsite_id': '2024TXN012'}}

    resolved = resolve_imported_dataset_info(existing, meta, additive=True)

    assert resolved['datasetInfo'] == {
        'cruise': '2403',  # preserved: the imported file did not carry it
        'sta_lat': '26.8195',  # preserved
        'year': '2025',  # imported wins on collision
        'gfishsite_id': '2024TXN012',  # added by the import
    }


def test_resolve_imported_dataset_info_overwrite_replaces_block():
    """Overwrite (additive=False) drops the existing block entirely."""
    existing = {'cruise': '2403', 'year': '2024'}
    meta = {'datasetInfo': {'year': '2025'}}

    resolved = resolve_imported_dataset_info(existing, meta, additive=False)

    assert resolved['datasetInfo'] == {'year': '2025'}


def test_resolve_imported_dataset_info_absent_leaves_meta_untouched():
    """A file carrying no datasetInfo never touches the existing block, in either mode."""
    existing = {'cruise': '2403'}
    meta = {'type': 'image-sequence'}

    assert resolve_imported_dataset_info(existing, meta, additive=True) == meta
    assert resolve_imported_dataset_info(existing, meta, additive=False) == meta


def test_resolve_imported_dataset_info_does_not_mutate_inputs():
    existing = {'cruise': '2403'}
    meta = {'datasetInfo': {'year': '2025'}}

    resolve_imported_dataset_info(existing, meta, additive=True)

    assert existing == {'cruise': '2403'}
    assert meta == {'datasetInfo': {'year': '2025'}}


@pytest.mark.parametrize(
    ('additive', 'expected'),
    [
        (False, {'year': '2025', 'gfishsite_id': '2024TXN012'}),
        (
            True,
            {
                'cruise': '2403',
                'sta_lat': '26.8195',
                'year': '2025',
                'gfishsite_id': '2024TXN012',
            },
        ),
    ],
)
@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud_dataset.update_metadata')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_process_items_resolves_dataset_info_from_dive_configuration_import(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    update_metadata,
    resolve_attachment_item_id,
    additive,
    expected,
):
    folder = {
        '_id': 'dataset-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'datasetInfo': {'cruise': '2403', 'sta_lat': '26.8195', 'year': '2024'},
        },
    }
    item = {'_id': 'item-id', 'name': 'metadata.config.json', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'metadata.config.json', 'exts': ['json']}
    payload = {
        'datasetInfo': {
            'year': '2025',
            'gfishsite_id': '2024TXN012',
        }
    }

    # The attachment resolver reaches Mongo through crud_dataset for its reserved-name
    # fallback, so it is stubbed here like every other process_items unit test.
    resolve_attachment_item_id.return_value = None
    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.return_value = iter([file])
    file_cls.return_value.download.return_value = lambda: [json.dumps(payload).encode()]
    get_auxiliary_folder.return_value = {'_id': 'auxiliary-id'}

    warnings = process_items(folder, {'_id': 'user-id'}, additive=additive)

    assert warnings == []
    item_cls.return_value.move.assert_called_once_with(item, {'_id': 'auxiliary-id'})
    update_metadata.assert_called_once()
    update_folder, update_payload, verify = update_metadata.call_args.args
    assert update_folder == folder
    assert update_payload['datasetInfo'] == expected
    assert update_payload['version'] == 1
    assert verify is False


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud_dataset.update_metadata')
@patch('dive_server.crud_rpc.crud.saveImportAttributes')
@patch('dive_server.crud_rpc.crud.get_multicam_parent_folder')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_process_items_syncs_mutable_config_to_multicam_parent(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    get_multicam_parent,
    save_import_attributes,
    update_metadata,
    resolve_attachment_item_id,
):
    """Camera-targeted DIVE config also updates the multicam parent the viewer reads."""
    # Use video so process_items skips valid_images (needs Mongo).
    camera_folder = {
        '_id': 'left-id',
        'parentId': 'parent-id',
        'meta': {
            'annotate': True,
            'type': 'video',
            'fps': 5,
        },
    }
    parent_folder = {
        '_id': 'parent-id',
        'meta': {
            'annotate': True,
            'type': 'multi',
            'fps': 5,
            'datasetInfo': {'cruise': '2403'},
        },
    }
    item = {'_id': 'item-id', 'name': 'metadata.config.json', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'metadata.config.json', 'exts': ['json']}
    payload = {
        'confidenceFilters': {'default': 0.8},
        'customTypeStyling': {'fish': {'color': '#00ff00'}},
        'datasetInfo': {'year': '2025'},
        'fps': 30,
        'imageEnhancements': {'brightness': 1.1},
        'cameraHomographies': {'left::right': {'AtoB': [[1]], 'BtoA': [[1]]}},
        'cameraCorrespondences': {'left::right': []},
        'cameraTransformTypes': {'left::right': 'similarity'},
        'cameraRegistrationSource': {'model': 'from-import'},
    }

    resolve_attachment_item_id.return_value = None
    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.return_value = iter([file])
    file_cls.return_value.download.return_value = lambda: [json.dumps(payload).encode()]
    get_auxiliary_folder.return_value = {'_id': 'auxiliary-id'}
    get_multicam_parent.return_value = parent_folder

    warnings = process_items(camera_folder, {'_id': 'user-id'}, additive=False)

    assert warnings == []
    get_multicam_parent.assert_called_once_with(camera_folder, {'_id': 'user-id'})
    save_import_attributes.assert_not_called()
    assert update_metadata.call_count == 2

    camera_call, parent_call = update_metadata.call_args_list
    assert camera_call.args[0] is camera_folder
    assert camera_call.args[1]['confidenceFilters'] == {'default': 0.8}
    assert camera_call.args[1]['datasetInfo'] == {'year': '2025'}
    assert camera_call.args[1]['fps'] == 30
    assert camera_call.args[2] is False

    assert parent_call.args[0] is parent_folder
    parent_payload = parent_call.args[1]
    assert parent_payload['confidenceFilters'] == {'default': 0.8}
    assert parent_payload['customTypeStyling'] == {'fish': {'color': '#00ff00'}}
    # Overwrite replaces parent datasetInfo; camera-local / registration keys stay off parent.
    assert parent_payload['datasetInfo'] == {'year': '2025'}
    assert 'fps' not in parent_payload
    assert 'imageEnhancements' not in parent_payload
    assert 'cameraHomographies' not in parent_payload
    assert 'cameraCorrespondences' not in parent_payload
    assert 'cameraTransformTypes' not in parent_payload
    assert 'cameraRegistrationSource' not in parent_payload
    assert parent_call.args[2] is False


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.dive.migrate')
@patch('dive_server.crud_rpc.viame.load_json_as_track_and_attributes')
@patch('dive_server.crud_rpc.crud_dataset.update_metadata')
@patch('dive_server.crud_rpc.crud.saveImportAttributes')
@patch('dive_server.crud_rpc.crud.get_multicam_parent_folder')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_process_items_syncs_track_attributes_to_multicam_parent(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    get_multicam_parent,
    save_import_attributes,
    update_metadata,
    load_json,
    migrate,
    save_annotations,
    resolve_attachment_item_id,
):
    """Annotation imports that derive attributes also union them onto the parent."""
    camera_folder = {
        '_id': 'left-id',
        'parentId': 'parent-id',
        'meta': {'annotate': True, 'type': 'video', 'fps': 5},
    }
    parent_folder = {
        '_id': 'parent-id',
        'meta': {'annotate': True, 'type': 'multi', 'fps': 5},
    }
    item = {'_id': 'item-id', 'name': 'tracks.dive.json', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'tracks.dive.json', 'exts': ['json']}
    payload = {
        'tracks': {
            '1': {
                'id': 1,
                'begin': 0,
                'end': 0,
                'confidencePairs': [['fish', 1.0]],
                'features': [{'frame': 0, 'bounds': [0, 0, 1, 1]}],
                'attributes': {},
            }
        },
        'groups': {},
        'version': 2,
    }
    attributes = {
        'species': {
            'key': 'species',
            'name': 'species',
            'belongs': 'track',
            'datatype': 'text',
        }
    }

    resolve_attachment_item_id.return_value = None
    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.return_value = iter([file])
    file_cls.return_value.download.return_value = lambda: [json.dumps(payload).encode()]
    get_auxiliary_folder.return_value = {'_id': 'auxiliary-id'}
    get_multicam_parent.return_value = parent_folder
    migrate.return_value = payload
    load_json.return_value = (payload, attributes)

    warnings = process_items(camera_folder, {'_id': 'user-id'})

    assert warnings == []
    save_annotations.assert_called_once()
    assert save_import_attributes.call_count == 2
    assert save_import_attributes.call_args_list[0].args[0] is camera_folder
    assert save_import_attributes.call_args_list[1].args[0] is parent_folder
    update_metadata.assert_not_called()


def test_pick_multicam_shared_mutable_keeps_only_shared_keys():
    from dive_server import crud

    picked = crud.pick_multicam_shared_mutable(
        {
            'fps': 30,
            'version': 1,
            'confidenceFilters': {'default': 0.5},
            'datasetInfo': {'year': '2025'},
            'typeHierarchy': {'salmon': 'fish'},
            'imageEnhancements': {'brightness': 1.2},
            'cameraHomographies': {'left::right': {'AtoB': [], 'BtoA': []}},
            'cameraCorrespondences': {'left::right': []},
            'cameraTransformTypes': {'left::right': 'similarity'},
            'cameraRegistrationSource': {'model': 'colmap'},
            'customTypeStyling': {'fish': {'color': '#0f0'}},
        }
    )
    assert picked == {
        'confidenceFilters': {'default': 0.5},
        'datasetInfo': {'year': '2025'},
        'customTypeStyling': {'fish': {'color': '#0f0'}},
    }
    assert 'typeHierarchy' not in picked
    assert 'imageEnhancements' not in picked
    assert 'cameraHomographies' not in picked
    assert 'cameraCorrespondences' not in picked
    assert 'cameraTransformTypes' not in picked
    assert 'cameraRegistrationSource' not in picked


def test_camera_patch_rejects_invalid_hierarchy_before_any_write(monkeypatch):
    import inspect
    from types import SimpleNamespace

    from dive_server.views_dataset import DatasetResource

    camera = {'_id': 'camera', 'meta': {'imageEnhancements': {'brightness': 1}}}
    parent = {'_id': 'parent', 'meta': {'typeHierarchy': {'salmon': 'fish'}}}
    update_metadata = MagicMock()
    monkeypatch.setattr(crud, 'get_multicam_parent_folder', lambda *_args: parent)
    monkeypatch.setattr(crud_dataset, 'update_metadata', update_metadata)
    resource = SimpleNamespace(getCurrentUser=lambda: {'_id': 'user'})

    with pytest.raises(RestException, match='self edge "fish -> fish"'):
        inspect.unwrap(DatasetResource.patch_metadata)(
            resource,
            camera,
            {
                'imageEnhancements': {'brightness': 2},
                'typeHierarchy': {'fish': 'fish'},
            },
        )

    update_metadata.assert_not_called()
    assert camera['meta'] == {'imageEnhancements': {'brightness': 1}}
    assert parent['meta'] == {'typeHierarchy': {'salmon': 'fish'}}


def test_camera_patch_rejects_invalid_camera_metadata_before_parent_write(monkeypatch):
    import inspect
    from types import SimpleNamespace

    from dive_server.views_dataset import DatasetResource

    camera = {'_id': 'camera', 'meta': {'confidenceFilters': {'default': 0.5}}}
    parent = {'_id': 'parent', 'meta': {'typeHierarchy': {'salmon': 'fish'}}}
    writes = []

    def update_metadata(target, data):
        validated = crud_dataset.MetadataMutableUpdateArgs(**data)
        target['meta'].update(validated.dict(exclude_none=True))
        writes.append(target['_id'])
        return target['meta']

    monkeypatch.setattr(crud, 'get_multicam_parent_folder', lambda *_args: parent)
    monkeypatch.setattr(crud_dataset, 'update_metadata', update_metadata)
    resource = SimpleNamespace(getCurrentUser=lambda: {'_id': 'user'})

    with pytest.raises(ValidationException, match='unexpectedField'):
        inspect.unwrap(DatasetResource.patch_metadata)(
            resource,
            camera,
            {
                'unexpectedField': True,
                'typeHierarchy': {'tuna': 'fish'},
            },
        )

    assert writes == []
    assert camera['meta'] == {'confidenceFilters': {'default': 0.5}}
    assert parent['meta'] == {'typeHierarchy': {'salmon': 'fish'}}


def test_camera_patch_rejects_hierarchy_without_parent_write_access(monkeypatch):
    import inspect
    from types import SimpleNamespace

    from dive_server.views_dataset import DatasetResource

    camera = {'_id': 'camera', 'meta': {}}
    parent = {'_id': 'parent', 'meta': {'typeHierarchy': {'salmon': 'fish'}}}
    update_metadata = MagicMock()
    monkeypatch.setattr(crud, 'get_multicam_parent_folder', lambda *_args: None)
    monkeypatch.setattr(crud, 'get_multicam_owner_folder', lambda _folder: parent)
    monkeypatch.setattr(crud_dataset, 'update_metadata', update_metadata)
    resource = SimpleNamespace(getCurrentUser=lambda: {'_id': 'user'})

    with pytest.raises(RestException) as error:
        inspect.unwrap(DatasetResource.patch_metadata)(
            resource,
            camera,
            {'typeHierarchy': {'tuna': 'fish'}},
        )

    assert error.value.code == 403
    update_metadata.assert_not_called()
    assert camera['meta'] == {}
    assert parent['meta'] == {'typeHierarchy': {'salmon': 'fish'}}


@patch('dive_server.crud.Folder')
def test_get_multicam_parent_folder_returns_parent_for_registered_camera(folder_cls):
    from girder.constants import AccessType

    from dive_server import crud
    from dive_utils import constants

    camera = {'_id': 'left-id', 'parentId': 'parent-id', 'meta': {'type': 'image-sequence'}}
    parent = {
        '_id': 'parent-id',
        'meta': {
            'type': constants.MultiType,
            'multiCam': {
                'defaultDisplay': 'left',
                'cameras': {'left': {'folderId': 'left-id', 'type': 'image-sequence'}},
            },
        },
    }
    folder_cls.return_value.load.return_value = parent
    folder_cls.return_value.hasAccess.return_value = True
    user = {'_id': 'user-id'}

    assert crud.get_multicam_parent_folder(camera, user) is parent
    # Membership is resolved without an ACL check so that insufficient access degrades to
    # None instead of raising AccessException past the caller's guards.
    folder_cls.return_value.load.assert_called_once_with('parent-id', force=True)
    folder_cls.return_value.hasAccess.assert_called_once_with(parent, user, AccessType.WRITE)


@patch('dive_server.crud.Folder')
def test_get_multicam_parent_folder_returns_none_without_parent_access(folder_cls):
    from dive_server import crud
    from dive_utils import constants

    camera = {'_id': 'left-id', 'parentId': 'parent-id', 'meta': {'type': 'image-sequence'}}
    parent = {
        '_id': 'parent-id',
        'meta': {
            'type': constants.MultiType,
            'multiCam': {
                'defaultDisplay': 'left',
                'cameras': {'left': {'folderId': 'left-id', 'type': 'image-sequence'}},
            },
        },
    }
    folder_cls.return_value.load.return_value = parent
    folder_cls.return_value.hasAccess.return_value = False

    assert crud.get_multicam_parent_folder(camera, {'_id': 'user-id'}) is None
    # The read-only owner lookup still resolves, so export keeps the parent's hierarchy.
    assert crud.get_multicam_owner_folder(camera) is parent


@patch('dive_server.crud.Folder')
def test_get_multicam_parent_folder_ignores_unregistered_child(folder_cls):
    from dive_server import crud
    from dive_utils import constants

    camera = {'_id': 'other-id', 'parentId': 'parent-id', 'meta': {'type': 'image-sequence'}}
    parent = {
        '_id': 'parent-id',
        'meta': {
            'type': constants.MultiType,
            'multiCam': {
                'defaultDisplay': 'left',
                'cameras': {'left': {'folderId': 'left-id', 'type': 'image-sequence'}},
            },
        },
    }
    folder_cls.return_value.load.return_value = parent

    assert crud.get_multicam_parent_folder(camera, {'_id': 'user-id'}) is None


def test_get_multicam_camera_name_returns_matching_camera():
    from dive_server import crud
    from dive_utils import constants

    parent = {
        '_id': 'parent-id',
        'meta': {
            'type': constants.MultiType,
            'multiCam': {
                'defaultDisplay': 'left',
                'cameras': {
                    'left': {'folderId': 'left-id', 'type': 'image-sequence'},
                    'right': {'folderId': 'right-id', 'type': 'image-sequence'},
                },
            },
        },
    }
    assert crud.get_multicam_camera_name({'_id': 'left-id'}, parent) == 'left'
    assert crud.get_multicam_camera_name({'_id': 'right-id'}, parent) == 'right'
    assert crud.get_multicam_camera_name({'_id': 'other-id'}, parent) is None
