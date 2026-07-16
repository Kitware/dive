from unittest.mock import patch

from girder.exceptions import RestException
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
def test_frame_metadata_csv_is_kept_in_place_for_every_media_type(
    folder_cls, item_cls, file_cls, get_auxiliary_folder, save_annotations, dataset_type
):
    folder = {'_id': 'ds', 'meta': {'type': dataset_type, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'frame_metadata.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'frame_metadata.csv', 'exts': ['csv']}

    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})

    warnings = process_items(folder, {'_id': 'user-id'})

    # Declared by name: marked processed and left in the dataset folder, never imported as
    # annotations, moved, or removed. The bytes are never even downloaded.
    assert len(warnings) == 1
    assert 'frame_metadata.csv' in warnings[0]
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
def test_frame_metadata_csv_marked_processed_is_not_reswept(
    folder_cls, item_cls, file_cls, get_auxiliary_folder
):
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'frame_metadata.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'frame_metadata.csv', 'exts': ['csv']}

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


@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.valid_images')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_two_plain_csvs_in_folder_side_door_guard(
    folder_cls, item_cls, file_cls, get_auxiliary_folder, valid_images, save_annotations
):
    # Two plain (non-frame-metadata) annotation CSVs can only reach the folder together outside the
    # pre-upload validation path. The guard fires before anything is removed, moved, or saved.
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item_a = {'_id': 'a', 'name': 'a.csv', 'meta': {}}
    item_b = {'_id': 'b', 'name': 'b.csv', 'meta': {}}
    file_a = {'_id': 'fa', 'name': 'a.csv', 'exts': ['csv']}
    file_b = {'_id': 'fb', 'name': 'b.csv', 'exts': ['csv']}

    folder_cls.return_value.childItems.return_value = [item_a, item_b]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect(
        {'a': file_a, 'b': file_b}
    )
    file_cls.return_value.download.side_effect = _download_side_effect(
        {'fa': _viame_csv('image_0001.jpg').encode(), 'fb': _viame_csv('image_0002.jpg').encode()}
    )

    with pytest.raises(RestException, match='Multiple annotation CSVs present') as excinfo:
        process_items(folder, {'_id': 'user-id'})

    assert 'a.csv' in str(excinfo.value)
    assert 'b.csv' in str(excinfo.value)
    item_cls.return_value.remove.assert_not_called()
    item_cls.return_value.move.assert_not_called()
    item_cls.return_value.save.assert_not_called()
    save_annotations.assert_not_called()
    get_auxiliary_folder.assert_not_called()


def _wire_declared_lookup(folder_cls, item_cls, all_items):
    """Emulate the two childItems query shapes plus a mutating setMetadata.

    The declaration pass looks items up by exact name; the sweep uses the $and regex/marker
    filter, emulated here as "unswept csv/json/yml items not yet marked processed".
    """

    def child_items(_folder, filters=None, sort=None):
        if filters and 'name' in filters:
            return [item for item in all_items if item['name'] == filters['name']]
        return [
            item
            for item in all_items
            if item['name'].lower().rsplit('.', 1)[-1] in ('csv', 'json', 'yml', 'yaml')
            and item['meta'].get(constants.ProcessedMarker) is not True
        ]

    def set_metadata(item, metadata):
        item['meta'].update(metadata)
        return item

    folder_cls.return_value.childItems.side_effect = child_items
    item_cls.return_value.setMetadata.side_effect = set_metadata


@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_declared_frame_metadata_names_are_marked_and_kept(
    folder_cls, item_cls, file_cls, get_auxiliary_folder, save_annotations
):
    # Arbitrary-named sidecars declared through frameMetadataNames are marked and left in
    # place — including .txt, which the sweep regexes never even list.
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item_csv = {'_id': 'a', 'name': 'nav_2024.csv', 'meta': {}}
    item_txt = {'_id': 'b', 'name': 'nav_2024.txt', 'meta': {}}
    _wire_declared_lookup(folder_cls, item_cls, [item_csv, item_txt])

    warnings = process_items(
        folder, {'_id': 'user-id'}, frameMetadataNames=['nav_2024.csv', 'nav_2024.txt']
    )

    assert len(warnings) == 2
    assert all('stays in the dataset folder' in warning for warning in warnings)
    for item in (item_csv, item_txt):
        assert item['meta'][constants.FrameMetadataMarker] is True
        assert item['meta'][constants.ProcessedMarker] is True
    item_cls.return_value.move.assert_not_called()
    item_cls.return_value.remove.assert_not_called()
    save_annotations.assert_not_called()
    file_cls.return_value.download.assert_not_called()


@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_declared_name_missing_from_folder_raises(folder_cls, item_cls):
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    _wire_declared_lookup(folder_cls, item_cls, [])

    with pytest.raises(RestException, match='was not found in the dataset folder'):
        process_items(folder, {'_id': 'user-id'}, frameMetadataNames=['nav_2024.csv'])
    item_cls.return_value.setMetadata.assert_not_called()


@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_declared_name_unsupported_extension_raises(folder_cls, item_cls):
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item = {'_id': 'a', 'name': 'nav.json', 'meta': {}}
    _wire_declared_lookup(folder_cls, item_cls, [item])

    with pytest.raises(RestException, match='not a supported frame metadata file type'):
        process_items(folder, {'_id': 'user-id'}, frameMetadataNames=['nav.json'])
    item_cls.return_value.setMetadata.assert_not_called()


@pytest.mark.parametrize('dataset_type', [constants.VideoType, constants.LargeImageType])
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_declared_names_rejected_for_unsupported_media_type(folder_cls, item_cls, dataset_type):
    folder = {'_id': 'ds', 'meta': {'type': dataset_type, 'fps': 5}}
    item = {'_id': 'a', 'name': 'nav_2024.csv', 'meta': {}}
    _wire_declared_lookup(folder_cls, item_cls, [item])

    with pytest.raises(RestException, match='only supported for image-sequence'):
        process_items(folder, {'_id': 'user-id'}, frameMetadataNames=['nav_2024.csv'])
    item_cls.return_value.setMetadata.assert_not_called()


@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_declared_names_allowed_for_multicam_parent(folder_cls, item_cls):
    # A declaration on the multicam parent folder is the shared-sidecar path.
    folder = {'_id': 'parent', 'meta': {'type': constants.MultiType, 'fps': 5}}
    item = {'_id': 'a', 'name': 'nav_2024.csv', 'meta': {}}
    _wire_declared_lookup(folder_cls, item_cls, [item])

    warnings = process_items(folder, {'_id': 'user-id'}, frameMetadataNames=['nav_2024.csv'])

    assert len(warnings) == 1
    assert item['meta'][constants.FrameMetadataMarker] is True
    assert item['meta'][constants.ProcessedMarker] is True


@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_marker_declared_item_short_circuits_sweep(
    folder_cls, item_cls, file_cls, get_auxiliary_folder, save_annotations
):
    # A marked-but-unprocessed item (e.g. a marking pass interrupted before ProcessedMarker
    # saved) must take the keep-in-place branch, never the annotation classifier.
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item = {
        '_id': 'item-id',
        'name': 'nav_2024.csv',
        'meta': {constants.FrameMetadataMarker: True},
    }
    file = {'_id': 'file-id', 'name': 'nav_2024.csv', 'exts': ['csv']}

    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})

    warnings = process_items(folder, {'_id': 'user-id'})

    assert len(warnings) == 1
    assert 'stays in the dataset folder' in warnings[0]
    assert item['meta'][constants.ProcessedMarker] is True
    item_cls.return_value.save.assert_called_once_with(item)
    item_cls.return_value.move.assert_not_called()
    item_cls.return_value.remove.assert_not_called()
    file_cls.return_value.download.assert_not_called()
    save_annotations.assert_not_called()


@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.valid_images')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_marked_csv_does_not_trip_two_csv_guard(
    folder_cls, item_cls, file_cls, get_auxiliary_folder, valid_images, save_annotations
):
    # A marker-declared sidecar CSV alongside one plain annotation CSV is not "two
    # annotation CSVs": the annotation imports and the sidecar stays put.
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    marked = {
        '_id': 'nav',
        'name': 'nav_2024.csv',
        'meta': {constants.FrameMetadataMarker: True},
    }
    plain = {'_id': 'ann', 'name': 'annotations.csv', 'meta': {}}
    file_marked = {'_id': 'f-nav', 'name': 'nav_2024.csv', 'exts': ['csv']}
    file_plain = {'_id': 'f-ann', 'name': 'annotations.csv', 'exts': ['csv']}

    folder_cls.return_value.childItems.return_value = [marked, plain]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect(
        {'nav': file_marked, 'ann': file_plain}
    )
    file_cls.return_value.download.side_effect = _download_side_effect(
        {'f-ann': _viame_csv().encode()}
    )
    get_auxiliary_folder.return_value = {'_id': 'aux-id'}
    valid_images.return_value = [{'name': 'image_0001.jpg'}]

    warnings = process_items(folder, {'_id': 'user-id'})

    assert len(warnings) == 1
    assert 'nav_2024.csv' in warnings[0]
    item_cls.return_value.move.assert_called_once_with(plain, {'_id': 'aux-id'})
    save_annotations.assert_called_once()
    assert marked['meta'][constants.ProcessedMarker] is True


@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.valid_images')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_undecodable_plain_csv_fails_loudly_with_rename_hint(
    folder_cls, item_cls, file_cls, get_auxiliary_folder, valid_images, save_annotations
):
    # A plain .csv whose bytes are not valid UTF-8 fails the strict annotation decode; the
    # loud failure carries the rename hint pointing frame metadata users at frame-metadata.csv.
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'annotations.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'annotations.csv', 'exts': ['csv']}
    # Latin-1 accented bytes are invalid UTF-8, so the utf-8-sig decode raises (ValueError).
    raw = 'filename,species\nimage_0001.jpg,poisson-\xe9p\xe9e\n'.encode('latin-1')

    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})
    file_cls.return_value.download.side_effect = _download_side_effect({'file-id': raw})
    valid_images.return_value = [{'name': 'image_0001.jpg'}, {'name': 'image_0002.jpg'}]

    with pytest.raises(RestException, match='Failed to import annotations.csv') as excinfo:
        process_items(folder, {'_id': 'user-id'})

    assert 'frame-metadata.csv' in str(excinfo.value)
    item_cls.return_value.remove.assert_called_once_with(item)
    save_annotations.assert_not_called()
