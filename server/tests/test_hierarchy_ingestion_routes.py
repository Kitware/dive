import copy
from unittest.mock import MagicMock

from girder.exceptions import RestException
import pytest

from dive_server import crud_rpc
from dive_utils import constants
from dive_utils.type_hierarchy import TypeHierarchyError


def test_recognized_malformed_configuration_is_retained_for_correction_and_retry(monkeypatch):
    item = {'_id': 'config-item'}
    file = {'name': 'config.json'}
    item_model = MagicMock()
    monkeypatch.setattr(crud_rpc, 'Item', lambda: item_model)
    parsed = {
        'annotations': None,
        'meta': {'typeHierarchy': {'salmon': 'fish'}},
        'attributes': None,
        'type': crud_rpc.crud.FileType.DIVE_CONF,
    }
    get_data = MagicMock(side_effect=[TypeHierarchyError('expected an object'), (parsed, [])])
    monkeypatch.setattr(crud_rpc, '_get_data_by_type', get_data)

    with pytest.raises(RestException, match='Type hierarchy is invalid: expected an object'):
        crud_rpc._parse_data_item(item, file, configuration_only=True)
    item_model.remove.assert_not_called()

    result, warnings = crud_rpc._parse_data_item(item, file, configuration_only=True)
    assert result == parsed
    assert warnings == []
    item_model.remove.assert_not_called()


def test_camera_configuration_hierarchy_requires_parent_write_access(monkeypatch):
    camera = {'_id': 'camera', 'parentId': 'parent', 'meta': {}}
    owner = {'_id': 'parent', 'meta': {'type': constants.MultiType}}
    item = {'_id': 'config-item'}
    file = {'name': 'config.json', 'exts': ['json']}
    parsed = {
        'annotations': None,
        'meta': {'typeHierarchy': {'salmon': 'fish'}},
        'attributes': None,
        'type': crud_rpc.crud.FileType.DIVE_CONF,
    }
    item_model = MagicMock()
    item_model.childFiles.return_value = iter([file])
    monkeypatch.setattr(crud_rpc, 'Item', lambda: item_model)
    monkeypatch.setattr(crud_rpc, '_fresh_folder_snapshot', lambda target: target)
    monkeypatch.setattr(crud_rpc, '_unprocessed_data_items', lambda _folder: [item])
    monkeypatch.setattr(
        crud_rpc,
        '_declared_sidecar_predicate',
        lambda *_args: (None, lambda _: False),
    )
    monkeypatch.setattr(crud_rpc, '_parse_data_item', lambda *_args, **_kwargs: (parsed, []))
    monkeypatch.setattr(crud_rpc.crud, 'get_multicam_parent_folder', lambda *_args: None)
    monkeypatch.setattr(crud_rpc.crud, 'get_multicam_owner_folder', lambda _folder: owner)

    with pytest.raises(
        RestException,
        match='Write access to the multicamera parent is required',
    ) as error:
        crud_rpc._prepare_configuration_imports(camera, {'_id': 'user'}, additive=False)

    assert error.value.code == 403


@pytest.mark.parametrize(
    ('additive', 'incoming', 'expected'),
    [
        (False, {'salmon': 'fish'}, {'salmon': 'fish'}),
        (True, {'salmon': 'fish'}, {'fish': 'animal', 'salmon': 'fish'}),
        (False, None, None),
    ],
)
def test_single_dataset_configuration_write_matrix(monkeypatch, additive, incoming, expected):
    folder = {
        '_id': 'dataset',
        'meta': {'typeHierarchy': {'fish': 'animal'}},
    }
    writes = []

    def update_metadata(target, payload, _verify, hierarchy_mode='save'):
        writes.append((target, copy.deepcopy(payload), hierarchy_mode))
        if payload.get('typeHierarchy') is None:
            target['meta'].pop('typeHierarchy', None)
        elif 'typeHierarchy' in payload:
            target['meta']['typeHierarchy'] = copy.deepcopy(payload['typeHierarchy'])
        return target['meta']

    monkeypatch.setattr(crud_rpc, '_fresh_folder_snapshot', lambda target: target)
    monkeypatch.setattr(crud_rpc.crud_dataset, 'update_metadata', update_metadata)
    plan = {
        'parent': None,
        'hierarchy_instructions': [(True, incoming)],
        'additive': additive,
        'staged_meta': {},
        'staged_parent_meta': {},
        'applied': False,
    }

    crud_rpc._apply_configuration_imports(folder, plan)

    assert folder['meta'].get('typeHierarchy') == expected
    assert writes[0][1].get('typeHierarchy') == expected


def test_camera_configuration_updates_only_parent_hierarchy(monkeypatch):
    parent = {
        '_id': 'parent',
        'meta': {
            'type': constants.MultiType,
            'typeHierarchy': {'fish': 'animal'},
        },
    }
    camera = {
        '_id': 'camera',
        'name': 'left',
        'meta': {'typeHierarchy': {'legacy': 'copy'}},
    }
    writes = []

    def update_metadata(target, payload, _verify, hierarchy_mode='save'):
        writes.append((target['_id'], copy.deepcopy(payload), hierarchy_mode))
        target['meta'].update(copy.deepcopy(payload))
        return target['meta']

    def remove_copy(target):
        return target['meta'].pop('typeHierarchy', None) is not None

    monkeypatch.setattr(crud_rpc, '_fresh_folder_snapshot', lambda target: target)
    monkeypatch.setattr(crud_rpc.crud_dataset, 'update_metadata', update_metadata)
    monkeypatch.setattr(crud_rpc.crud_dataset, 'remove_camera_type_hierarchy', remove_copy)
    plan = {
        'parent': parent,
        'hierarchy_instructions': [(True, {'salmon': 'fish'})],
        'additive': True,
        'staged_meta': {'imageEnhancements': {'brightness': 1.1}},
        'staged_parent_meta': {'confidenceFilters': {'default': 0.4}},
        'applied': False,
    }

    crud_rpc._apply_configuration_imports(camera, plan)

    assert writes == [
        ('camera', {'imageEnhancements': {'brightness': 1.1}}, 'additive'),
        (
            'parent',
            {
                'confidenceFilters': {'default': 0.4},
                'typeHierarchy': {
                    'fish': 'animal',
                    'legacy': 'copy',
                    'salmon': 'fish',
                },
            },
            'additive',
        ),
    ]
    assert 'typeHierarchy' not in camera['meta']
    assert parent['meta']['typeHierarchy'] == {
        'fish': 'animal',
        'legacy': 'copy',
        'salmon': 'fish',
    }
    assert plan['warnings'] == [
        'Removed a type hierarchy stored on camera left; '
        'the type hierarchy for a multicamera dataset is stored on the parent.'
    ]


def test_camera_hierarchy_removal_warning_reaches_import_warnings(monkeypatch):
    monkeypatch.setattr(
        crud_rpc.crud_dataset,
        'resolve_metadata_attachment_item_id',
        lambda _folder, _user: None,
    )
    message = (
        'Removed a type hierarchy stored on camera left; '
        'the type hierarchy for a multicamera dataset is stored on the parent.'
    )
    plan = {
        'parent': None,
        'unprocessed_items': [],
        'item_files': {},
        'parsed_json_items': {},
        'applied': True,
        'hierarchy_write': {'action': 'none'},
        'warnings': [message],
    }

    warnings = crud_rpc.process_items(
        {'_id': 'camera', 'meta': {}}, {'_id': 'user-id'}, configuration_plan=plan
    )

    assert warnings == [message]


def test_camera_without_stored_hierarchy_import_warns_nothing(monkeypatch):
    parent = {'_id': 'parent', 'meta': {'type': constants.MultiType}}
    camera = {'_id': 'camera', 'name': 'left', 'meta': {}}
    monkeypatch.setattr(crud_rpc, '_fresh_folder_snapshot', lambda target: target)
    monkeypatch.setattr(crud_rpc.crud_dataset, 'update_metadata', MagicMock())
    monkeypatch.setattr(
        crud_rpc.crud_dataset,
        'remove_camera_type_hierarchy',
        lambda target: target['meta'].pop('typeHierarchy', None) is not None,
    )
    plan = {
        'parent': parent,
        'hierarchy_instructions': [],
        'additive': False,
        'staged_meta': {},
        'staged_parent_meta': {},
        'applied': False,
    }

    crud_rpc._apply_configuration_imports(camera, plan)

    assert 'warnings' not in plan


def test_camera_configuration_conflict_is_rejected_before_writes(monkeypatch):
    parent = {'_id': 'parent', 'meta': {'typeHierarchy': {'salmon': 'fish'}}}
    camera = {'_id': 'camera', 'meta': {}}
    update_metadata = MagicMock()
    monkeypatch.setattr(crud_rpc, '_fresh_folder_snapshot', lambda target: target)
    monkeypatch.setattr(crud_rpc.crud_dataset, 'update_metadata', update_metadata)
    plan = {
        'parent': parent,
        'hierarchy_instructions': [(True, {'salmon': 'mammal'})],
        'additive': True,
        'staged_meta': {},
        'staged_parent_meta': {},
        'applied': False,
    }

    with pytest.raises(RestException, match='conflicting parents for "salmon"'):
        crud_rpc._apply_configuration_imports(camera, plan)
    update_metadata.assert_not_called()


def test_camera_stored_hierarchy_is_promoted_without_new_configuration(monkeypatch):
    parent = {'_id': 'parent', 'meta': {'type': constants.MultiType}}
    camera = {
        '_id': 'camera',
        'name': 'left',
        'meta': {'typeHierarchy': {'salmon': 'fish'}},
    }

    def update_metadata(target, payload, _verify, hierarchy_mode='save'):
        target['meta'].update(copy.deepcopy(payload))
        return target['meta']

    monkeypatch.setattr(crud_rpc, '_fresh_folder_snapshot', lambda target: target)
    monkeypatch.setattr(crud_rpc.crud_dataset, 'update_metadata', update_metadata)
    monkeypatch.setattr(
        crud_rpc.crud_dataset,
        'remove_camera_type_hierarchy',
        lambda target: target['meta'].pop('typeHierarchy', None) is not None,
    )
    plan = {
        'parent': parent,
        'hierarchy_instructions': [],
        'additive': False,
        'staged_meta': {},
        'staged_parent_meta': {},
        'applied': False,
    }

    crud_rpc._apply_configuration_imports(camera, plan)

    assert parent['meta']['typeHierarchy'] == {'salmon': 'fish'}
    assert 'typeHierarchy' not in camera['meta']


def test_conflicting_camera_hierarchy_is_skipped_before_incoming_configuration(monkeypatch):
    parent = {'_id': 'parent', 'meta': {'typeHierarchy': {'salmon': 'fish'}}}
    camera = {
        '_id': 'camera',
        'name': 'left',
        'meta': {'typeHierarchy': {'salmon': 'mammal'}},
    }

    def update_metadata(target, payload, _verify, hierarchy_mode='save'):
        target['meta'].update(copy.deepcopy(payload))
        return target['meta']

    monkeypatch.setattr(crud_rpc, '_fresh_folder_snapshot', lambda target: target)
    monkeypatch.setattr(crud_rpc.crud_dataset, 'update_metadata', update_metadata)
    monkeypatch.setattr(
        crud_rpc.crud_dataset,
        'remove_camera_type_hierarchy',
        lambda target: target['meta'].pop('typeHierarchy', None) is not None,
    )
    plan = {
        'parent': parent,
        'hierarchy_instructions': [(True, {'shark': 'fish'})],
        'additive': True,
        'staged_meta': {},
        'staged_parent_meta': {},
        'applied': False,
    }

    crud_rpc._apply_configuration_imports(camera, plan)

    assert parent['meta']['typeHierarchy'] == {'salmon': 'fish', 'shark': 'fish'}
    assert plan['warnings'][0] == (
        'Camera "left" type hierarchy was skipped: '
        'conflicting parents for "salmon": "fish" and "mammal"'
    )


def test_failed_parent_save_leaves_camera_hierarchy_for_retry(monkeypatch):
    parent = {'_id': 'parent', 'meta': {}}
    camera = {
        '_id': 'camera',
        'name': 'left',
        'meta': {'typeHierarchy': {'salmon': 'fish'}},
    }
    monkeypatch.setattr(crud_rpc, '_fresh_folder_snapshot', lambda target: target)
    monkeypatch.setattr(
        crud_rpc.crud_dataset,
        'update_metadata',
        MagicMock(side_effect=RuntimeError('parent save failed')),
    )
    remove_copy = MagicMock()
    monkeypatch.setattr(crud_rpc.crud_dataset, 'remove_camera_type_hierarchy', remove_copy)
    plan = {
        'parent': parent,
        'hierarchy_instructions': [],
        'additive': False,
        'staged_meta': {},
        'staged_parent_meta': {},
        'applied': False,
    }

    with pytest.raises(RuntimeError, match='parent save failed'):
        crud_rpc._apply_configuration_imports(camera, plan)

    assert camera['meta']['typeHierarchy'] == {'salmon': 'fish'}
    remove_copy.assert_not_called()


def test_postprocess_delegates_without_private_preflight_protocol(monkeypatch):
    expected = {'folder': {'_id': 'dataset'}, 'job_ids': []}
    postprocess = MagicMock(return_value=expected)
    monkeypatch.setattr(crud_rpc, '_postprocess', postprocess)

    result = crud_rpc.postprocess(
        {'_id': 'user'},
        {'_id': 'dataset'},
        True,
        additive=True,
    )

    assert result == expected
    postprocess.assert_called_once_with(
        {'_id': 'user'}, {'_id': 'dataset'}, True, False, True, '', ''
    )
