from datetime import datetime
from unittest.mock import patch

from dive_server import crud_annotation
from dive_server.crud_annotation import DATASET, IDENTIFIER, REVISION, REVISION_CREATED

VISIBLE_QUERY = {DATASET: 'dataset-id', 'visible': True}


@patch('dive_server.crud_annotation.RevisionLogItem')
@patch('dive_server.crud_annotation.TrackItem')
def test_track_authors_joins_revision_log(track_item, revision_log):
    """Each visible track carries the author of the revision that created it."""
    saved = datetime(2026, 1, 17, 18, 49)
    track_item.return_value.list_query.return_value = VISIBLE_QUERY
    track_item.return_value.find.return_value = [
        {IDENTIFIER: 1, 'begin': 0, 'end': 4, REVISION_CREATED: 2, 'featureCount': 5},
        {IDENTIFIER: 2, 'begin': 3, 'end': 3, REVISION_CREATED: 3, 'featureCount': 1},
        {IDENTIFIER: 3, 'begin': 7, 'end': 9, REVISION_CREATED: 2, 'featureCount': 3},
    ]
    track_item.return_value.collection.count_documents.return_value = 3
    revision_log.return_value.find.return_value = [
        {
            REVISION: 2,
            'author_id': 'user-a',
            'author_name': 'alice',
            'created': saved,
            'description': 'save',
        },
        {
            REVISION: 3,
            'author_id': 'user-b',
            'author_name': 'bob',
            'created': saved,
            'description': 'Import VIAME_CSV from detections.csv',
        },
    ]

    tracks, total = crud_annotation.track_authors(
        {'_id': 'dataset-id'}, limit=10, offset=0, revision=None, set=None
    )

    assert total == 3
    assert [(t[IDENTIFIER], t['author_name']) for t in tracks] == [
        (1, 'alice'),
        (2, 'bob'),
        (3, 'alice'),
    ]
    assert tracks[1]['description'] == 'Import VIAME_CSV from detections.csv'
    assert tracks[0]['created'] == saved

    track_item.return_value.list_query.assert_called_once_with({'_id': 'dataset-id'}, None, None)
    track_kwargs = track_item.return_value.find.call_args.kwargs
    assert track_kwargs['query'] == VISIBLE_QUERY
    # Features are counted in mongo rather than returned (find projection expression)
    assert 'features' not in track_kwargs['fields']
    assert track_kwargs['fields']['featureCount'] == {
        '$size': {'$ifNull': ['$features', []]},
    }
    track_item.return_value.collection.count_documents.assert_called_once_with(VISIBLE_QUERY)

    # One revision log lookup covers every distinct revision on the page
    revision_query = revision_log.return_value.find.call_args.kwargs['query']
    assert revision_query[DATASET] == 'dataset-id'
    assert sorted(revision_query[REVISION]['$in']) == [2, 3]


@patch('dive_server.crud_annotation.RevisionLogItem')
@patch('dive_server.crud_annotation.TrackItem')
def test_track_authors_missing_revision_entry(track_item, revision_log):
    """A track whose revision log entry is gone is still listed, without an author."""
    track_item.return_value.list_query.return_value = VISIBLE_QUERY
    track_item.return_value.find.return_value = [
        {IDENTIFIER: 1, 'begin': 0, 'end': 0, REVISION_CREATED: 5, 'featureCount': 1},
    ]
    track_item.return_value.collection.count_documents.return_value = 1
    revision_log.return_value.find.return_value = []

    tracks, total = crud_annotation.track_authors({'_id': 'dataset-id'})

    assert total == 1
    assert tracks[0][IDENTIFIER] == 1
    assert tracks[0]['author_name'] is None
    assert tracks[0]['author_id'] is None
