from unittest.mock import patch

import pytest

from dive_server.crud_rpc import process_items
from dive_utils import constants

VIAME_HEADER = (
    '# 1: Detection or Track-id, 2: Video or Image Identifier, 3: Unique Frame Identifier, '
    '4-7: Img-bbox(TL_x,TL_y,BR_x,BR_y), 8: Detection or Length Confidence, '
    '9: Fish Length, 10-11+: Repeated Species'
)


def _viame_csv(filename='image_0001.jpg'):
    """A minimal, well-formed VIAME annotation CSV with the DIVE comment header."""
    return f'{VIAME_HEADER}\n0,{filename},0,10,10,50,50,1.0,-1,fish,0.9\n'


def _download_side_effect(bytes_by_file_id):
    def download(file, headers=False):
        return lambda: [bytes_by_file_id[file['_id']]]

    return download


def _childfiles_side_effect(file_by_item_id):
    def child_files(item):
        return iter([file_by_item_id[item['_id']]])

    return child_files


@pytest.mark.parametrize(
    'dataset_type',
    [constants.VideoType, constants.LargeImageType, constants.ImageSequenceType],
)
@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_meta_csv_is_kept_in_place_for_every_media_type(
    folder_cls, item_cls, file_cls, get_auxiliary_folder, save_annotations, dataset_type
):
    folder = {'_id': 'ds', 'meta': {'type': dataset_type, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'nav.meta.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'nav.meta.csv', 'exts': ['meta', 'csv']}

    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})

    warnings = process_items(folder, {'_id': 'user-id'})

    # Declared by name: marked processed and left in the dataset folder, never imported as
    # annotations, moved, or removed. The bytes are never even downloaded.
    assert len(warnings) == 1
    assert 'nav.meta.csv' in warnings[0]
    assert 'stays in the dataset folder' in warnings[0]
    assert item['meta'][constants.ProcessedMarker] is True
    item_cls.return_value.save.assert_called_once_with(item)
    item_cls.return_value.move.assert_not_called()
    item_cls.return_value.remove.assert_not_called()
    save_annotations.assert_not_called()
    file_cls.return_value.download.assert_not_called()


@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_meta_csv_marked_processed_is_not_reswept(
    folder_cls, item_cls, file_cls, get_auxiliary_folder
):
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'navigation.meta.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'navigation.meta.csv', 'exts': ['meta', 'csv']}

    # Emulate the ProcessedMarker "$ne: True" query filter: a marked sidecar is no longer
    # listed, so a later process_items call never re-adjudicates it.
    def child_items(_folder, filters=None, sort=None):
        if item['meta'].get(constants.ProcessedMarker) is True:
            return []
        return [item]

    folder_cls.return_value.childItems.side_effect = child_items
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})

    warnings = process_items(folder, {'_id': 'user-id'})
    assert len(warnings) == 1
    assert item['meta'][constants.ProcessedMarker] is True
    item_cls.return_value.save.assert_called_once_with(item)

    # Second pass: the marked sidecar is excluded, so it is not re-saved or re-warned.
    second_warnings = process_items(folder, {'_id': 'user-id'})
    assert second_warnings == []
    item_cls.return_value.save.assert_called_once()


@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.valid_images')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_plain_annotation_csv_still_imports(
    folder_cls, item_cls, file_cls, get_auxiliary_folder, valid_images, save_annotations
):
    # The keep-in-place guard must not intercept an ordinary annotation CSV: it is still
    # moved to the auxiliary folder and its tracks saved.
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'annotations.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'annotations.csv', 'exts': ['csv']}

    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})
    file_cls.return_value.download.side_effect = _download_side_effect(
        {'file-id': _viame_csv().encode()}
    )
    get_auxiliary_folder.return_value = {'_id': 'aux-id'}
    valid_images.return_value = [{'name': 'image_0001.jpg'}, {'name': 'image_0002.jpg'}]

    warnings = process_items(folder, {'_id': 'user-id'})

    assert warnings == []
    item_cls.return_value.move.assert_called_once_with(item, {'_id': 'aux-id'})
    save_annotations.assert_called_once()
    # An imported annotation is not tagged as a kept-in-place sidecar.
    item_cls.return_value.save.assert_not_called()
