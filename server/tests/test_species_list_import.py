"""Importing a KWCOCO species list: the classes a dataset declares its readers may use."""

import copy
import json
from unittest.mock import patch

from girder.exceptions import RestException
import pytest

from dive_server.crud_rpc import process_items
from dive_utils import constants


def _species_list(categories):
    return json.dumps({'categories': categories}).encode()


ROCKFISH = [
    {'id': 1, 'name': 'Sebastes'},
    {'id': 2, 'name': 'Sebastes melanops', 'supercategory': 'Sebastes'},
    {'id': 3, 'name': 'Sebastes flavidus', 'supercategory': 'Sebastes'},
]


def _download_side_effect(bytes_by_file_id):
    def download(file, headers=False):
        return lambda: [bytes_by_file_id[file['_id']]]

    return download


def _childfiles_side_effect(file_by_item_id):
    def child_files(item):
        return iter([file_by_item_id[item['_id']]])

    return child_files


def _run(item_cls, file_cls, folder_cls, folder, payloads, **kwargs):
    """Sweep one dataset folder holding the given ``{filename: bytes}`` items."""
    items = []
    files = {}
    file_bytes = {}
    for index, (name, raw) in enumerate(payloads.items()):
        item = {'_id': f'item-{index}', 'name': name, 'meta': {}}
        file = {'_id': f'file-{index}', 'name': name, 'exts': [name.rsplit('.', 1)[-1]]}
        items.append(item)
        files[item['_id']] = file
        file_bytes[file['_id']] = raw
    folder_cls.return_value.childItems.return_value = items
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect(files)
    file_cls.return_value.download.side_effect = _download_side_effect(file_bytes)
    return process_items(folder, {'_id': 'user-id'}, **kwargs)


def _record_metadata_writes(writes):
    def update_metadata(target, payload, _verify=True, hierarchy_mode='save'):
        writes.append((target['_id'], copy.deepcopy(payload), hierarchy_mode))
        applied = copy.deepcopy(payload)
        hierarchy = applied.pop('typeHierarchy', 'absent')
        target['meta'].update(applied)
        if hierarchy is None:
            target['meta'].pop('typeHierarchy', None)
        elif hierarchy != 'absent':
            target['meta']['typeHierarchy'] = hierarchy
        return target['meta']

    return update_metadata


@pytest.fixture
def dataset():
    return {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}


@pytest.fixture(autouse=True)
def _girder_stubs():
    with (
        patch(
            'dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id',
            return_value=None,
        ),
        patch('dive_server.crud_rpc.crud.refresh_folder_document'),
        patch('dive_server.crud_rpc.crud.valid_images', return_value=[]),
        patch(
            'dive_server.crud_rpc.crud.get_or_create_auxiliary_folder',
            return_value={'_id': 'aux-id'},
        ),
        patch('dive_server.crud_rpc.crud_annotation.save_annotations') as save_annotations,
    ):
        yield save_annotations


@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_species_list_declares_types_and_hierarchy_without_annotations(
    folder_cls, item_cls, file_cls, dataset, _girder_stubs
):
    writes = []
    with patch(
        'dive_server.crud_rpc.crud_dataset.update_metadata',
        side_effect=_record_metadata_writes(writes),
    ):
        warnings = _run(
            item_cls,
            file_cls,
            folder_cls,
            dataset,
            {'rockfish.species.json': _species_list(ROCKFISH)},
        )

    assert warnings == []
    # Every declared species is listed, and a species with no style of its own costs an
    # empty entry that renders in the ordinal palette.
    assert dataset['meta']['customTypeStyling'] == {
        'Sebastes': {},
        'Sebastes melanops': {},
        'Sebastes flavidus': {},
    }
    assert dataset['meta']['typeHierarchy'] == {
        'Sebastes melanops': 'Sebastes',
        'Sebastes flavidus': 'Sebastes',
    }
    # A declaration is not an observation: nothing was annotated by importing it.
    _girder_stubs.assert_not_called()
    item_cls.return_value.move.assert_called_once()


@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_overwrite_replaces_the_declared_list_and_keeps_named_types_styles(
    folder_cls, item_cls, file_cls, dataset, _girder_stubs
):
    dataset['meta']['customTypeStyling'] = {
        'Sebastes': {'color': '#ff0000'},
        'retired species': {'color': '#00ff00'},
    }
    dataset['meta']['typeHierarchy'] = {'retired species': 'legacy'}
    writes = []
    with patch(
        'dive_server.crud_rpc.crud_dataset.update_metadata',
        side_effect=_record_metadata_writes(writes),
    ):
        _run(item_cls, file_cls, folder_cls, dataset, {'species.json': _species_list(ROCKFISH)})

    assert dataset['meta']['customTypeStyling'] == {
        'Sebastes': {'color': '#ff0000'},
        'Sebastes melanops': {},
        'Sebastes flavidus': {},
    }
    assert dataset['meta']['typeHierarchy'] == {
        'Sebastes melanops': 'Sebastes',
        'Sebastes flavidus': 'Sebastes',
    }


@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_additive_adds_to_the_declared_list(folder_cls, item_cls, file_cls, dataset, _girder_stubs):
    dataset['meta']['customTypeStyling'] = {'Anoplopoma fimbria': {'color': '#00ff00'}}
    dataset['meta']['typeHierarchy'] = {'Anoplopoma fimbria': 'Anoplopoma'}
    writes = []
    with patch(
        'dive_server.crud_rpc.crud_dataset.update_metadata',
        side_effect=_record_metadata_writes(writes),
    ):
        _run(
            item_cls,
            file_cls,
            folder_cls,
            dataset,
            {'species.json': _species_list(ROCKFISH)},
            additive=True,
        )

    assert dataset['meta']['customTypeStyling'] == {
        'Anoplopoma fimbria': {'color': '#00ff00'},
        'Sebastes': {},
        'Sebastes melanops': {},
        'Sebastes flavidus': {},
    }
    assert dataset['meta']['typeHierarchy'] == {
        'Anoplopoma fimbria': 'Anoplopoma',
        'Sebastes melanops': 'Sebastes',
        'Sebastes flavidus': 'Sebastes',
    }


@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_flat_list_clears_the_hierarchy_on_overwrite_and_leaves_it_on_additive(
    folder_cls, item_cls, file_cls, dataset, _girder_stubs
):
    flat = _species_list([{'id': 1, 'name': 'Sebastes'}])
    for additive, expected in ((True, {'salmon': 'fish'}), (False, None)):
        folder = copy.deepcopy(dataset)
        folder['meta']['typeHierarchy'] = {'salmon': 'fish'}
        with patch(
            'dive_server.crud_rpc.crud_dataset.update_metadata',
            side_effect=_record_metadata_writes([]),
        ):
            _run(
                item_cls,
                file_cls,
                folder_cls,
                folder,
                {'species.json': flat},
                additive=additive,
            )
        assert folder['meta'].get('typeHierarchy') == expected


@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_unusable_hierarchy_fails_the_import_without_changing_anything(
    folder_cls, item_cls, file_cls, dataset, _girder_stubs
):
    # A species list is imported for its classes, so a cycle is an error rather than a
    # warning that silently degrades the list to a flat one.
    cyclic = _species_list(
        [
            {'id': 1, 'name': 'a', 'supercategory': 'b'},
            {'id': 2, 'name': 'b', 'supercategory': 'a'},
        ]
    )
    with patch('dive_server.crud_rpc.crud_dataset.update_metadata') as update_metadata:
        with pytest.raises(RestException, match='Type hierarchy is invalid'):
            _run(item_cls, file_cls, folder_cls, dataset, {'species.json': cyclic})

    update_metadata.assert_not_called()
    assert 'customTypeStyling' not in dataset['meta']


@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_a_coco_document_with_media_is_still_imported_as_annotations(
    folder_cls, item_cls, file_cls, dataset, _girder_stubs
):
    # Media present means an ordinary COCO document: its categories still supply hierarchy,
    # but they do not become a declared type list.
    document = json.dumps(
        {
            'images': [{'id': 1, 'file_name': 'image_0001.jpg', 'frame_index': 0}],
            'annotations': [
                {'id': 1, 'image_id': 1, 'category_id': 2, 'bbox': [1, 2, 3, 4], 'score': 1.0}
            ],
            'categories': ROCKFISH,
        }
    ).encode()
    writes = []
    with patch(
        'dive_server.crud_rpc.crud_dataset.update_metadata',
        side_effect=_record_metadata_writes(writes),
    ):
        _run(item_cls, file_cls, folder_cls, dataset, {'tracks.json': document})

    assert 'customTypeStyling' not in dataset['meta']
    assert dataset['meta']['typeHierarchy'] == {
        'Sebastes melanops': 'Sebastes',
        'Sebastes flavidus': 'Sebastes',
    }
    _girder_stubs.assert_called_once()


@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_species_list_on_one_camera_declares_types_on_the_multicam_parent(
    folder_cls, item_cls, file_cls, _girder_stubs
):
    # The viewer reads the declared types and the hierarchy from the parent, so a list
    # imported against a single camera has to reach the whole dataset.
    parent = {
        '_id': 'parent',
        'meta': {
            'type': constants.MultiType,
            'customTypeStyling': {'Sebastes': {'color': '#ff0000'}},
        },
    }
    camera = {
        '_id': 'left',
        'name': 'left',
        'meta': {'type': constants.ImageSequenceType, 'fps': 5},
    }
    writes = []
    with (
        patch('dive_server.crud_rpc.crud.get_multicam_parent_folder', return_value=parent),
        patch('dive_server.crud_rpc.crud_dataset.remove_camera_type_hierarchy', return_value=False),
        patch(
            'dive_server.crud_rpc.crud_dataset.update_metadata',
            side_effect=_record_metadata_writes(writes),
        ),
    ):
        _run(item_cls, file_cls, folder_cls, camera, {'species.json': _species_list(ROCKFISH)})

    assert parent['meta']['customTypeStyling'] == {
        'Sebastes': {'color': '#ff0000'},
        'Sebastes melanops': {},
        'Sebastes flavidus': {},
    }
    assert parent['meta']['typeHierarchy'] == {
        'Sebastes melanops': 'Sebastes',
        'Sebastes flavidus': 'Sebastes',
    }
    # The hierarchy for a multicamera dataset lives only on the parent.
    assert 'typeHierarchy' not in camera['meta']
