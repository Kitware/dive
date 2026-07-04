import types as pytypes
from unittest.mock import patch

from dive_server import event
from dive_utils.constants import AnnotationFileFutureProcessMarker


def _event(info):
    return pytypes.SimpleNamespace(info=info)


# A real 24-hex ObjectId is required because process_assetstore_import wraps creatorId in ObjectId.
_OWNER_ID = '000000000000000000000000'


@patch('dive_server.event.User')
@patch('dive_server.event.Folder')
@patch('dive_server.event.Item')
def test_assetstore_import_leaves_meta_sidecar_unmarked(item_cls, folder_cls, user_cls):
    item = {'_id': 'i1', 'name': 'nav.meta.csv', 'meta': {}, 'folderId': 'f1'}
    item_model = item_cls.return_value
    item_model.findOne.return_value = item

    event.process_assetstore_import(
        _event({'type': 'item', 'importPath': '/data/nav.meta.csv', 'id': 'i1'}),
        {},
    )

    # Declared sidecar: no future-process marker, no save, no relocation, folder untouched.
    assert AnnotationFileFutureProcessMarker not in item['meta']
    item_model.save.assert_not_called()
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


@patch('dive_server.event.Folder')
@patch('dive_server.event.Item')
def test_process_dangling_skips_meta_sidecar(item_cls, folder_cls):
    meta_item = {
        '_id': 'm1',
        'name': 'nav.meta.csv',
        'meta': {AnnotationFileFutureProcessMarker: True},
        'folderId': 'f1',
    }
    item_model = item_cls.return_value
    item_model.find.return_value = [meta_item]
    folder_model = folder_cls.return_value
    folder_model.childFolders.return_value = []

    event.process_dangling_annotation_files({'_id': 'f1'}, {'_id': 'u1'})

    # The declared sidecar is skipped: marker unchanged, never saved or relocated.
    assert meta_item['meta'][AnnotationFileFutureProcessMarker] is True
    item_model.save.assert_not_called()
    item_model.move.assert_not_called()
    folder_model.findOne.assert_not_called()
