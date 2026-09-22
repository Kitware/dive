from copy import deepcopy
import json

from dive_server import crud_annotation, crud_dataset


def test_type_filter_prunes_exported_confidence_pairs_without_mutating_storage(monkeypatch):
    tracks = {
        '7': {
            'id': 7,
            'begin': 0,
            'end': 0,
            'confidencePairs': [['fish', 0.8], ['shark', 0.4]],
            'attributes': {},
            'features': [{'frame': 0, 'bounds': [1, 2, 3, 4]}],
        }
    }
    monkeypatch.setattr(
        crud_annotation,
        'get_annotations',
        lambda _folder, revision=None: {'tracks': tracks},
    )

    exported = crud_dataset._filtered_annotation_tracks({'meta': {}}, None, False, {'fish'})

    assert exported == {
        '7': {
            **deepcopy(tracks['7']),
            'confidencePairs': [['fish', 0.8]],
        }
    }
    assert tracks['7']['confidencePairs'] == [['fish', 0.8], ['shark', 0.4]]


def test_type_filter_matches_raw_pair_membership_not_hierarchy_resolution(monkeypatch):
    tracks = {
        '7': {
            'id': 7,
            'begin': 0,
            'end': 0,
            'confidencePairs': [['fish', 0.8]],
            'attributes': {},
            'features': [{'frame': 0, 'bounds': [1, 2, 3, 4]}],
        }
    }
    monkeypatch.setattr(
        crud_annotation,
        'get_annotations',
        lambda _folder, revision=None: {'tracks': tracks},
    )
    folder = {'meta': {'typeHierarchy': {'salmon': 'fish'}}}

    assert crud_dataset._filtered_annotation_tracks(folder, None, False, {'fish'}) == {
        '7': deepcopy(tracks['7']),
    }
    assert crud_dataset._filtered_annotation_tracks(folder, None, False, {'salmon'}) == {}


def test_export_filters_prune_threshold_and_type_pairs_without_mutating_storage(monkeypatch):
    tracks = {
        '7': {
            'id': 7,
            'begin': 0,
            'end': 0,
            'confidencePairs': [['fish', 0.8], ['shark', 0.4], ['ray', 0.9]],
            'attributes': {},
            'features': [{'frame': 0, 'bounds': [1, 2, 3, 4]}],
        }
    }
    monkeypatch.setattr(
        crud_annotation,
        'get_annotations',
        lambda _folder, revision=None: {'tracks': tracks},
    )
    folder = {'meta': {'confidenceFilters': {'default': 0.5, 'fish': 0.85}}}

    exported = crud_dataset._filtered_annotation_tracks(folder, None, True, {'fish', 'ray'})

    assert exported['7']['confidencePairs'] == [['ray', 0.9]]
    assert exported['7'] is not tracks['7']
    assert tracks['7']['confidencePairs'] == [['fish', 0.8], ['shark', 0.4], ['ray', 0.9]]


def test_full_archive_dive_json_prunes_filtered_pairs_without_mutating_storage(monkeypatch):
    tracks = {
        '7': {
            'id': 7,
            'begin': 0,
            'end': 0,
            'confidencePairs': [['fish', 0.8], ['shark', 0.4]],
            'attributes': {},
            'features': [{'frame': 0, 'bounds': [1, 2, 3, 4]}],
        }
    }
    monkeypatch.setattr(
        crud_annotation,
        'get_annotations',
        lambda _folder, revision=None: {'tracks': tracks},
    )
    monkeypatch.setattr(crud_dataset.crud, 'getCloneRoot', lambda _user, folder: folder)

    class Zip:
        def addFile(self, maker, path):
            if str(path).endswith('annotations.dive.json'):
                for data in maker():
                    yield data.encode()

    chunks = list(
        crud_dataset._yield_single_dataset_export(
            Zip(),
            './dataset/',
            {'name': 'dataset', 'meta': {}},
            {'_id': 'user'},
            includeMedia=False,
            includeDetections=True,
            excludeBelowThreshold=False,
            typeFilter={'fish'},
        )
    )

    exported = json.loads(next(chunk for chunk in chunks if b'confidencePairs' in chunk))
    assert exported['tracks']['7']['confidencePairs'] == [['fish', 0.8]]
    assert tracks['7']['confidencePairs'] == [['fish', 0.8], ['shark', 0.4]]


def test_library_labels_use_raw_highest_score_and_exclude_empty_vectors(monkeypatch):
    captured = {}

    class Collection:
        def aggregate(self, pipeline):
            captured['pipeline'] = pipeline
            return ['raw-result']

    class FolderModel:
        collection = Collection()

    monkeypatch.setattr(crud_annotation, 'Folder', lambda: FolderModel())
    monkeypatch.setattr(crud_dataset, 'get_dataset_query', lambda *args, **kwargs: {})

    assert crud_annotation.get_labels({'_id': 'user'}) == ['raw-result']
    lookup_pipeline = captured['pipeline'][1]['$lookup']['pipeline']
    reducer = lookup_pipeline[3]['$set']['confidencePairs']['$reduce']
    assert reducer['input'] == '$confidencePairs'
    assert reducer['initialValue'] == []
    condition = reducer['in']['$cond'][0]['$or']
    assert condition[1] == {
        '$gt': [
            {'$arrayElemAt': ['$$this', 1]},
            {'$arrayElemAt': ['$$value', 1]},
        ],
    }
    assert lookup_pipeline[4] == {
        '$set': {
            'confidencePairs': {
                '$arrayElemAt': ['$confidencePairs', 0],
            },
        },
    }
    assert lookup_pipeline[5] == {
        '$match': {
            '$expr': {
                '$eq': [{'$type': '$confidencePairs'}, 'string'],
            },
        },
    }
