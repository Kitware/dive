"""Model uploads are private, complete, and only then discoverable."""

from io import BytesIO
from unittest.mock import MagicMock
from zipfile import ZipFile

from girder.exceptions import RestException
import pytest

from dive_server import crud_rpc, model_pack
from dive_utils.constants import TrainedPipelineMarker


def archive():
    source = BytesIO()
    with ZipFile(source, 'w') as output:
        output.writestr('configs/pipelines/custom.pipe', 'relativepath model = models/fish.onnx')
        output.writestr('configs/pipelines/models/fish.onnx', b'weights')
        output.writestr('configs/pipelines/labels.txt', 'fish')
    source.seek(0)
    return source


@pytest.fixture
def storage(monkeypatch):
    folders = MagicMock()
    uploads = MagicMock()
    folders.findOne.return_value = None
    folders.createFolder.side_effect = lambda parent, name, **kwargs: {'_id': name, 'name': name}
    monkeypatch.setattr(model_pack, 'Folder', lambda: folders)
    monkeypatch.setattr(model_pack, 'Upload', lambda: uploads)
    monkeypatch.setattr(crud_rpc, 'training_output_folder', lambda user: {'_id': 'training'})
    return folders, uploads


def test_upload_preserves_paths_and_marks_pack_only_when_complete(storage):
    folders, uploads = storage
    received = {}

    def upload(stream, size, name, **kwargs):
        folders.setMetadata.assert_not_called()
        received[(kwargs['parent']['name'], name)] = stream.read()
        assert len(received[(kwargs['parent']['name'], name)]) == size

    uploads.uploadFromFile.side_effect = upload
    user = {'_id': 'owner'}
    result = model_pack.import_model_pack(user, archive(), 'fish.zip')
    assert result == {'folderId': 'fish', 'name': 'fish'}
    assert received == {
        ('fish', 'custom.pipe'): b'relativepath model = models/fish.onnx',
        ('fish', 'labels.txt'): b'fish',
        ('models', 'fish.onnx'): b'weights',
    }
    folders.createFolder.assert_any_call({'_id': 'training'}, 'fish', creator=user, public=False)
    folders.setMetadata.assert_called_once_with(
        {'_id': 'fish', 'name': 'fish'}, {TrainedPipelineMarker: True}
    )
    folders.remove.assert_not_called()


def test_failed_upload_removes_incomplete_pack(storage):
    folders, uploads = storage
    uploads.uploadFromFile.side_effect = RuntimeError('Assetstore unavailable')
    with pytest.raises(RuntimeError, match='Assetstore'):
        model_pack.import_model_pack({'_id': 'owner'}, archive(), 'fish.zip')
    folders.remove.assert_called_once_with({'_id': 'fish', 'name': 'fish'})
    folders.setMetadata.assert_not_called()


def test_duplicate_import_gets_a_new_name(storage):
    folders, _ = storage
    folders.findOne.side_effect = [{'_id': 'existing'}, None]
    assert (
        model_pack.import_model_pack({'_id': 'owner'}, archive(), 'fish.zip')['name'] == 'fish (2)'
    )
    folders.remove.assert_not_called()


def test_invalid_zip_does_not_create_a_pack(storage):
    folders, _ = storage
    with pytest.raises(RestException):
        model_pack.import_model_pack({'_id': 'owner'}, BytesIO(b'not a zip'), 'fish.zip')
    folders.createFolder.assert_not_called()


def test_dynamic_models_disambiguate_arbitrary_pipeline_names(monkeypatch):
    folders = MagicMock()
    folder = {'_id': 'pack', 'name': 'Fish', 'ownerLogin': 'owner', 'creatorId': 'user'}
    folders.collection.aggregate.return_value = iter([{'results': [folder]}])
    folders.filter.side_effect = lambda doc, **kwargs: doc
    folders.childItems.return_value = [
        {'name': 'custom.pipe'},
        {'name': 'another.pipe'},
        {'name': 'weights.pt'},
    ]
    monkeypatch.setattr(crud_rpc, 'Folder', lambda: folders)
    models = crud_rpc._load_dynamic_pipelines({'_id': 'user'})
    pipes = models['trained']['pipes']
    assert [p['name'] for p in pipes] == ['Fish custom', 'Fish another']
    # .pt is not accepted by the ONNX job (only .weights/.ckpt/.pth).
    assert all(p['onnxConvertible'] is False for p in pipes)


def test_dynamic_models_mark_onnx_convertible_when_weights_present(monkeypatch):
    folders = MagicMock()
    folder = {'_id': 'pack', 'name': 'Fish', 'ownerLogin': 'owner', 'creatorId': 'user'}
    folders.collection.aggregate.return_value = iter([{'results': [folder]}])
    folders.filter.side_effect = lambda doc, **kwargs: doc
    folders.childItems.return_value = [
        {'name': 'detector.pipe'},
        {'name': 'model.pth'},
    ]
    monkeypatch.setattr(crud_rpc, 'Folder', lambda: folders)
    models = crud_rpc._load_dynamic_pipelines({'_id': 'user'})
    assert models['trained']['pipes'] == [
        {
            'name': 'Fish detector',
            'type': 'trained',
            'pipe': 'detector.pipe',
            'folderId': 'pack',
            'ownerLogin': 'owner',
            'ownerId': 'user',
            'onnxConvertible': True,
        }
    ]
