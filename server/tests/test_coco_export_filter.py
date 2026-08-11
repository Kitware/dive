from copy import deepcopy

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
