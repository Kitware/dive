import types as pytypes
from unittest.mock import patch

from dive_server import event
from dive_utils.constants import (
    AnnotationFileFutureProcessMarker,
    FrameMetadataFileMarker,
    MetadataFileItemIdMarker,
    MetadataFileOriginalNameMarker,
    ProcessedMarker,
)
from dive_utils.frame_metadata import (
    canonical_frame_metadata_name,
    parse_video_paired_metadata_name,
)


def _event(info):
    return pytypes.SimpleNamespace(info=info)


# A real 24-hex ObjectId is required because process_assetstore_import wraps creatorId in ObjectId.
_OWNER_ID = '000000000000000000000000'


@patch('dive_server.event.User')
@patch('dive_server.event.Folder')
@patch('dive_server.event.Item')
def test_assetstore_import_tags_meta_sidecar(item_cls, folder_cls, user_cls):
    item = {'_id': 'i1', 'name': 'frame_metadata.csv', 'meta': {}, 'folderId': 'f1'}
    item_model = item_cls.return_value
    item_model.findOne.return_value = item

    event.process_assetstore_import(
        _event({'type': 'item', 'importPath': '/data/frame_metadata.csv', 'id': 'i1'}),
        {},
    )

    # Declared sidecar: tagged for Girder UI, no future-process marker, no relocation.
    assert AnnotationFileFutureProcessMarker not in item['meta']
    item_model.setMetadata.assert_called_once_with(
        item,
        {FrameMetadataFileMarker: 'true'},
    )
    item_model.move.assert_not_called()
    folder_cls.return_value.findOne.assert_not_called()


@patch('dive_server.event.User')
@patch('dive_server.event.Folder')
@patch('dive_server.event.Item')
def test_assetstore_import_marks_plain_annotation_csv(item_cls, folder_cls, user_cls):
    item = {'_id': 'i1', 'name': 'dets.csv', 'meta': {}, 'folderId': 'f1'}
    item_model = item_cls.return_value
    item_model.findOne.return_value = item
    parent_folder = {'_id': 'f1', 'creatorId': _OWNER_ID, 'baseParentId': None, 'meta': {}}
    folder_model = folder_cls.return_value

    def find_one(query):
        if query == {'_id': 'f1'}:
            return parent_folder
        return None  # no co-named video folder exists

    folder_model.findOne.side_effect = find_one
    user_cls.return_value.findOne.return_value = {'_id': _OWNER_ID}

    event.process_assetstore_import(
        _event({'type': 'item', 'importPath': '/data/dets.csv', 'id': 'i1'}),
        {},
    )

    # A plain annotation CSV is still marked for future processing, as on main.
    assert item['meta'][AnnotationFileFutureProcessMarker] is True
    item_model.save.assert_called_once()
    item_model.move.assert_not_called()


def test_parse_video_paired_metadata_name():
    assert parse_video_paired_metadata_name('reef_metadata.csv') == ('reef', 'csv')
    assert parse_video_paired_metadata_name('reef-metadata.JSON') == ('reef', 'json')
    assert parse_video_paired_metadata_name('path/to/clip_metadata.txt') == ('clip', 'txt')
    assert parse_video_paired_metadata_name('reef.csv') is None
    assert parse_video_paired_metadata_name('reef_annotations.csv') is None
    assert canonical_frame_metadata_name('CSV') == 'frame_metadata.csv'


@patch('dive_server.event.File')
@patch('dive_server.event.User')
@patch('dive_server.event.Folder')
@patch('dive_server.event.Item')
def test_assetstore_import_relocates_video_paired_metadata(
    item_cls, folder_cls, user_cls, file_cls
):
    item = {
        '_id': 'i1',
        'name': 'reef_metadata.csv',
        'meta': {},
        'folderId': 'parent',
        'lowerName': 'reef_metadata.csv',
    }
    item_model = item_cls.return_value
    item_model.findOne.return_value = item
    item_model.save.side_effect = lambda doc: doc
    item_model.childFiles.return_value = iter([{'name': 'reef_metadata.csv', '_id': 'file1'}])
    parent_folder = {'_id': 'parent', 'creatorId': _OWNER_ID, 'baseParentId': None, 'meta': {}}
    video_folder = {'_id': 'video', 'name': 'reef', 'meta': {'type': 'video'}}
    folder_model = folder_cls.return_value
    folder_model.childItems.return_value = []

    def find_one(query):
        if query == {'_id': 'parent'}:
            return parent_folder
        if query == {'_id': 'video'}:
            return video_folder
        if query == {'parentId': 'parent', 'name': 'reef'}:
            return video_folder
        return None

    folder_model.findOne.side_effect = find_one

    event.process_assetstore_import(
        _event({'type': 'item', 'importPath': '/data/reef_metadata.csv', 'id': 'i1'}),
        {},
    )

    assert item['name'] == 'frame_metadata.csv'
    assert item['meta'][FrameMetadataFileMarker] == 'true'
    assert item['meta'][ProcessedMarker] is True
    assert item['meta'][AnnotationFileFutureProcessMarker] is False
    item_model.move.assert_called_once_with(item, video_folder)
    item_model.remove.assert_not_called()
    file_cls.return_value.save.assert_called_once()
    assert file_cls.return_value.save.call_args.args[0]['name'] == 'frame_metadata.csv'
    assert video_folder['meta'][MetadataFileItemIdMarker] == 'i1'
    assert video_folder['meta'][MetadataFileOriginalNameMarker] == 'frame_metadata.csv'
    folder_model.save.assert_called_once_with(video_folder)


@patch('dive_server.event.File')
@patch('dive_server.event.User')
@patch('dive_server.event.Folder')
@patch('dive_server.event.Item')
def test_assetstore_import_replaces_existing_frame_metadata_on_reimport(
    item_cls, folder_cls, user_cls, file_cls
):
    item = {
        '_id': 'new-meta',
        'name': 'reef_metadata.json',
        'meta': {},
        'folderId': 'parent',
        'lowerName': 'reef_metadata.json',
    }
    old_meta = {
        '_id': 'old-meta',
        'name': 'frame_metadata.csv',
        'meta': {FrameMetadataFileMarker: 'true', ProcessedMarker: True},
        'folderId': 'video',
    }
    item_model = item_cls.return_value
    item_model.findOne.return_value = item
    item_model.save.side_effect = lambda doc: doc
    item_model.childFiles.return_value = iter([])
    parent_folder = {'_id': 'parent', 'creatorId': _OWNER_ID, 'baseParentId': None, 'meta': {}}
    video_folder = {
        '_id': 'video',
        'name': 'reef',
        'meta': {
            'type': 'video',
            MetadataFileItemIdMarker: 'old-meta',
            MetadataFileOriginalNameMarker: 'frame_metadata.csv',
        },
    }
    folder_model = folder_cls.return_value
    folder_model.childItems.return_value = [old_meta]

    def find_one(query):
        if query == {'_id': 'parent'}:
            return parent_folder
        if query == {'_id': 'video'}:
            return video_folder
        if query == {'parentId': 'parent', 'name': 'reef'}:
            return video_folder
        return None

    folder_model.findOne.side_effect = find_one

    event.process_assetstore_import(
        _event({'type': 'item', 'importPath': '/data/reef_metadata.json', 'id': 'new-meta'}),
        {},
    )

    item_model.remove.assert_called_once_with(old_meta)
    assert item['name'] == 'frame_metadata.json'
    item_model.move.assert_called_once_with(item, video_folder)
    assert video_folder['meta'][MetadataFileItemIdMarker] == 'new-meta'
    assert video_folder['meta'][MetadataFileOriginalNameMarker] == 'frame_metadata.json'


@patch('dive_server.event.User')
@patch('dive_server.event.Folder')
@patch('dive_server.event.Item')
def test_assetstore_import_defers_video_paired_metadata_without_folder(
    item_cls, folder_cls, user_cls
):
    item = {'_id': 'i1', 'name': 'reef-metadata.json', 'meta': {}, 'folderId': 'parent'}
    item_model = item_cls.return_value
    item_model.findOne.return_value = item
    parent_folder = {'_id': 'parent', 'creatorId': _OWNER_ID, 'baseParentId': None, 'meta': {}}
    folder_model = folder_cls.return_value

    def find_one(query):
        if query == {'_id': 'parent'}:
            return parent_folder
        return None

    folder_model.findOne.side_effect = find_one

    event.process_assetstore_import(
        _event({'type': 'item', 'importPath': '/data/reef-metadata.json', 'id': 'i1'}),
        {},
    )

    assert item['meta'][AnnotationFileFutureProcessMarker] is True
    assert item['name'] == 'reef-metadata.json'  # rename waits until the video folder exists
    item_model.move.assert_not_called()
    item_model.save.assert_called_once()


@patch('dive_server.event.File')
@patch('dive_server.event.Folder')
@patch('dive_server.event.Item')
def test_dangling_relocates_deferred_video_paired_metadata(item_cls, folder_cls, file_cls):
    item = {
        '_id': 'i1',
        'name': 'reef_metadata.txt',
        'meta': {AnnotationFileFutureProcessMarker: True},
        'folderId': 'parent',
        'lowerName': 'reef_metadata.txt',
    }
    item_model = item_cls.return_value
    item_model.find.return_value = [item]
    item_model.save.side_effect = lambda doc: doc
    item_model.childFiles.return_value = iter([])
    parent_folder = {'_id': 'parent', 'meta': {}}
    video_folder = {'_id': 'video', 'name': 'reef', 'meta': {'type': 'video'}}
    folder_model = folder_cls.return_value
    folder_model.childItems.return_value = []

    def find_one(query):
        if query == {'_id': 'parent'}:
            return parent_folder
        if query == {'_id': 'video'}:
            return video_folder
        if query.get('name') == 'reef':
            return video_folder
        return None

    folder_model.findOne.side_effect = find_one
    folder_model.childFolders.return_value = []

    event.process_dangling_annotation_files({'_id': 'parent'}, {'_id': _OWNER_ID})

    assert item['name'] == 'frame_metadata.txt'
    assert item['meta'][FrameMetadataFileMarker] == 'true'
    assert item['meta'][AnnotationFileFutureProcessMarker] is False
    item_model.move.assert_called_once_with(item, video_folder)
    assert video_folder['meta'][MetadataFileItemIdMarker] == 'i1'
