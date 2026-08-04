from unittest.mock import patch

from girder.exceptions import RestException
import pytest

from dive_server.crud_rpc import process_items
from dive_utils import constants, frame_metadata

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
@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud.refresh_folder_document')
@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_frame_metadata_csv_is_kept_in_place_for_every_media_type(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    save_annotations,
    refresh_folder_document,
    resolve_attachment_item_id,
    dataset_type,
):
    folder = {'_id': 'ds', 'meta': {'type': dataset_type, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'frame_metadata.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'frame_metadata.csv', 'exts': ['csv']}

    resolve_attachment_item_id.return_value = 'item-id'
    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})

    warnings = process_items(folder, {'_id': 'user-id'})

    # Declared by name: marked processed and left in the dataset folder, never imported as
    # annotations, moved, or removed. The bytes are never even downloaded.
    assert len(warnings) == 1
    assert 'frame_metadata.csv' in warnings[0]
    assert 'stays in the dataset folder' in warnings[0]
    assert item['meta'][constants.ProcessedMarker] is True
    assert item['meta'][constants.FrameMetadataFileMarker] == 'true'
    item_cls.return_value.save.assert_called_once_with(item)
    item_cls.return_value.move.assert_not_called()
    item_cls.return_value.remove.assert_not_called()
    save_annotations.assert_not_called()
    file_cls.return_value.download.assert_not_called()
    # The resolved attachment is recorded on the folder so later consumers need no rescan.
    assert folder['meta'][constants.MetadataFileItemIdMarker] == 'item-id'
    assert folder['meta'][constants.MetadataFileOriginalNameMarker] == 'frame_metadata.csv'


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud.refresh_folder_document')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_reserved_txt_sidecar_is_swept_like_the_other_reserved_names(
    folder_cls, item_cls, refresh_folder_document, resolve_attachment_item_id
):
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'frame_metadata.txt', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'frame_metadata.txt', 'exts': ['txt']}

    resolve_attachment_item_id.return_value = 'item-id'
    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})

    warnings = process_items(folder, {'_id': 'user-id'})

    # .txt matches none of the annotation extension regexes, so the reserved-name predicate
    # has to be part of the sweep query or a reserved .txt attachment is never discovered
    # (AUV flight logs are .txt).
    filters = folder_cls.return_value.childItems.call_args.kwargs['filters']
    assert frame_metadata.frame_metadata_source_name_query() in filters['$and'][0]['$or']
    assert len(warnings) == 1
    assert 'frame_metadata.txt' in warnings[0]
    assert item['meta'][constants.ProcessedMarker] is True
    assert item['meta'][constants.FrameMetadataFileMarker] == 'true'
    assert folder['meta'][constants.MetadataFileItemIdMarker] == 'item-id'


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud.refresh_folder_document')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_swept_sidecar_write_keeps_concurrently_written_folder_keys(
    folder_cls, item_cls, refresh_folder_document, resolve_attachment_item_id
):
    # An async convert_video job writes annotate / originalFps / ffprobe_info onto the folder
    # while this sweep runs. Girder's save is a full-document replace, so the attachment write
    # must refresh first or it replaces the folder with its pre-dispatch copy.
    folder = {'_id': 'ds', 'meta': {'type': constants.VideoType, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'frame_metadata.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'frame_metadata.csv', 'exts': ['csv']}

    def concurrent_job_write(target):
        target['meta']['annotate'] = True
        target['meta']['originalFps'] = 30

    resolve_attachment_item_id.return_value = 'item-id'
    refresh_folder_document.side_effect = concurrent_job_write
    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})

    process_items(folder, {'_id': 'user-id'})

    refresh_folder_document.assert_called_once_with(folder)
    saved = folder_cls.return_value.save.call_args.args[0]
    assert saved['meta']['annotate'] is True
    assert saved['meta']['originalFps'] == 30
    assert saved['meta'][constants.MetadataFileItemIdMarker] == 'item-id'


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud.refresh_folder_document')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_frame_metadata_csv_marked_processed_is_not_reswept(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    refresh_folder_document,
    resolve_attachment_item_id,
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

    resolve_attachment_item_id.return_value = 'item-id'
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


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.valid_images')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_plain_annotation_csv_still_imports(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    valid_images,
    save_annotations,
    resolve_attachment_item_id,
):
    # The keep-in-place guard must not intercept an ordinary annotation CSV: it is still
    # moved to the auxiliary folder and its tracks saved.
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'annotations.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'annotations.csv', 'exts': ['csv']}

    resolve_attachment_item_id.return_value = None
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


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.valid_images')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_two_plain_csvs_import_the_oldest_and_warn_about_the_rest(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    valid_images,
    save_annotations,
    resolve_attachment_item_id,
):
    # This sweep is the convergence point for headless writers (assetstore/S3), where nobody
    # picked these files: two annotation CSVs must not fail the folder. The oldest imports and
    # the rest are named in a warning, left untouched for a later sweep.
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    oldest = {'_id': 'a', 'name': 'detections.csv', 'meta': {}}
    newer = {'_id': 'b', 'name': 'tracks.csv', 'meta': {}}
    file_a = {'_id': 'fa', 'name': 'detections.csv', 'exts': ['csv']}
    file_b = {'_id': 'fb', 'name': 'tracks.csv', 'exts': ['csv']}

    resolve_attachment_item_id.return_value = None
    folder_cls.return_value.childItems.return_value = [oldest, newer]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect(
        {'a': file_a, 'b': file_b}
    )
    file_cls.return_value.download.side_effect = _download_side_effect(
        {'fa': _viame_csv('image_0001.jpg').encode(), 'fb': _viame_csv('image_0002.jpg').encode()}
    )
    get_auxiliary_folder.return_value = {'_id': 'aux-id'}
    valid_images.return_value = [{'name': 'image_0001.jpg'}, {'name': 'image_0002.jpg'}]

    warnings = process_items(folder, {'_id': 'user-id'})

    assert len(warnings) == 1
    assert 'detections.csv' in warnings[0]
    assert 'tracks.csv' in warnings[0]
    save_annotations.assert_called_once()
    item_cls.return_value.move.assert_called_once_with(oldest, {'_id': 'aux-id'})
    item_cls.return_value.remove.assert_not_called()
    # The skipped CSV is untouched: unmarked, unmoved, and still available to import.
    assert newer['meta'] == {}


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_more_than_one_reserved_metadata_item_warns_and_attaches_none(
    folder_cls,
    item_cls,
    save_annotations,
    resolve_attachment_item_id,
):
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    items = [
        {'_id': 'a', 'name': 'frame_metadata.csv', 'meta': {}},
        {'_id': 'b', 'name': 'frame-metadata.json', 'meta': {}},
    ]
    files = {
        'a': {'_id': 'f-a', 'name': 'frame_metadata.csv', 'exts': ['csv']},
        'b': {'_id': 'f-b', 'name': 'frame-metadata.json', 'exts': ['json']},
    }
    resolve_attachment_item_id.return_value = None
    folder_cls.return_value.childItems.return_value = items
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect(files)

    warnings = process_items(folder, {'_id': 'user-id'})

    # The assetstore/S3 sweep has no file picker and nothing to correct pre-upload, so
    # ambiguity degrades to a warning: raising here would strip the folder's retry marker
    # and skip the fps finalize. Both files stay put, so deleting one and re-importing lets
    # the reserved-name fallback resolve the survivor.
    ambiguity = next(w for w in warnings if 'More than one metadata file' in w)
    assert 'frame_metadata.csv' in ambiguity
    assert 'frame-metadata.json' in ambiguity
    assert 'None was attached' in ambiguity
    assert constants.MetadataFileItemIdMarker not in folder['meta']
    # Neither is imported as annotations, moved, or removed.
    save_annotations.assert_not_called()
    item_cls.return_value.move.assert_not_called()
    item_cls.return_value.remove.assert_not_called()
    folder_cls.return_value.save.assert_not_called()
    assert all(item['meta'][constants.ProcessedMarker] is True for item in items)
    assert all(item['meta'][constants.FrameMetadataFileMarker] == 'true' for item in items)


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud.refresh_folder_document')
@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_attached_item_short_circuits_sweep(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    save_annotations,
    refresh_folder_document,
    resolve_attachment_item_id,
):
    folder = {
        '_id': 'ds',
        'meta': {
            'type': constants.ImageSequenceType,
            'fps': 5,
            constants.MetadataFileItemIdMarker: 'item-id',
        },
    }
    item = {
        '_id': 'item-id',
        'name': 'nav_2024.csv',
        'meta': {},
    }
    file = {'_id': 'file-id', 'name': 'nav_2024.csv', 'exts': ['csv']}

    resolve_attachment_item_id.return_value = 'item-id'
    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})

    warnings = process_items(folder, {'_id': 'user-id'})

    assert len(warnings) == 1
    assert 'stays in the dataset folder' in warnings[0]
    assert item['meta'][constants.ProcessedMarker] is True
    assert item['meta'][constants.FrameMetadataFileMarker] == 'true'
    item_cls.return_value.save.assert_called_once_with(item)
    item_cls.return_value.move.assert_not_called()
    item_cls.return_value.remove.assert_not_called()
    file_cls.return_value.download.assert_not_called()
    save_annotations.assert_not_called()
    # The attachment is already recorded, so the sweep writes nothing to the folder.
    refresh_folder_document.assert_not_called()
    folder_cls.return_value.save.assert_not_called()


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.valid_images')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_attached_csv_does_not_trip_two_csv_guard(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    valid_images,
    save_annotations,
    resolve_attachment_item_id,
):
    # An attached CSV alongside one plain annotation CSV is not "two
    # annotation CSVs": the annotation imports and the sidecar stays put.
    folder = {
        '_id': 'ds',
        'meta': {
            'type': constants.ImageSequenceType,
            'fps': 5,
            constants.MetadataFileItemIdMarker: 'nav',
        },
    }
    marked = {
        '_id': 'nav',
        'name': 'nav_2024.csv',
        'meta': {},
    }
    plain = {'_id': 'ann', 'name': 'annotations.csv', 'meta': {}}
    file_marked = {'_id': 'f-nav', 'name': 'nav_2024.csv', 'exts': ['csv']}
    file_plain = {'_id': 'f-ann', 'name': 'annotations.csv', 'exts': ['csv']}

    resolve_attachment_item_id.return_value = 'nav'
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
    assert marked['meta'][constants.FrameMetadataFileMarker] == 'true'


@patch('dive_server.crud_rpc.crud_dataset.resolve_metadata_attachment_item_id')
@patch('dive_server.crud_rpc.crud_annotation.save_annotations')
@patch('dive_server.crud_rpc.crud.valid_images')
@patch('dive_server.crud_rpc.crud.get_or_create_auxiliary_folder')
@patch('dive_server.crud_rpc.File')
@patch('dive_server.crud_rpc.Item')
@patch('dive_server.crud_rpc.Folder')
def test_undecodable_plain_csv_fails_loudly_with_rename_hint(
    folder_cls,
    item_cls,
    file_cls,
    get_auxiliary_folder,
    valid_images,
    save_annotations,
    resolve_attachment_item_id,
):
    # A plain .csv whose bytes are not valid UTF-8 fails the annotation decode; the loud
    # failure carries the hint pointing frame metadata users at the upload page field and
    # the reserved name.
    folder = {'_id': 'ds', 'meta': {'type': constants.ImageSequenceType, 'fps': 5}}
    item = {'_id': 'item-id', 'name': 'annotations.csv', 'meta': {}}
    file = {'_id': 'file-id', 'name': 'annotations.csv', 'exts': ['csv']}
    raw = 'filename,species\nimage_0001.jpg,poisson-\xe9p\xe9e\n'.encode('latin-1')

    resolve_attachment_item_id.return_value = None
    folder_cls.return_value.childItems.return_value = [item]
    item_cls.return_value.childFiles.side_effect = _childfiles_side_effect({'item-id': file})
    file_cls.return_value.download.side_effect = _download_side_effect({'file-id': raw})
    valid_images.return_value = [{'name': 'image_0001.jpg'}, {'name': 'image_0002.jpg'}]

    with pytest.raises(RestException, match='Failed to import annotations.csv') as excinfo:
        process_items(folder, {'_id': 'user-id'})

    assert 'Metadata File (Optional)' in str(excinfo.value)
    assert 'frame-metadata.csv' in str(excinfo.value)
    item_cls.return_value.remove.assert_called_once_with(item)
    save_annotations.assert_not_called()
