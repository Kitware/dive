from unittest.mock import patch

from dive_server import crud_annotation
from dive_server.crud_annotation import (
    DATASET,
    IDENTIFIER,
    REVISION,
    REVISION_CREATED,
    REVISION_DELETED,
)


@patch('dive_server.crud_annotation.GroupItem')
@patch('dive_server.crud_annotation.TrackItem')
@patch('dive_server.crud_annotation.RevisionLogItem')
def test_rollback_issues_correct_queries(revision_log, track_item, group_item):
    """Records are removed by rev_created, but restored by rev_deleted."""
    crud_annotation.rollback({'_id': 'dataset-id'}, 4)

    revision_log.return_value.removeWithQuery.assert_called_once_with(
        {DATASET: 'dataset-id', REVISION: {'$gt': 4}}
    )

    for model in (track_item, group_item):
        model.return_value.removeWithQuery.assert_called_once_with(
            {DATASET: 'dataset-id', REVISION_CREATED: {'$gt': 4}}
        )
        # Restoring must select tombstoned records by REVISION_DELETED.  Selecting
        # them by REVISION_CREATED (the original defect) only matches records that
        # removeWithQuery already dropped, so nothing is ever un-deleted.
        model.return_value.update.assert_called_once_with(
            {DATASET: 'dataset-id', REVISION_DELETED: {'$gt': 4}},
            {'$unset': {REVISION_DELETED: ""}},
        )


class FakeCollection:
    """Minimal stand-in for the mongo-backed track/group models."""

    def __init__(self, docs):
        self.docs = [dict(doc) for doc in docs]

    @staticmethod
    def _matches(doc, query):
        for key, condition in query.items():
            if isinstance(condition, dict):
                for operator, value in condition.items():
                    if operator == '$gt' and not (key in doc and doc[key] > value):
                        return False
                    if operator == '$exists' and (key in doc) != value:
                        return False
            elif doc.get(key) != condition:
                return False
        return True

    def removeWithQuery(self, query):
        self.docs = [doc for doc in self.docs if not self._matches(doc, query)]

    def update(self, query, update):
        for doc in self.docs:
            if self._matches(doc, query):
                for field in update.get('$unset', {}):
                    doc.pop(field, None)

    def save(self, dataset, upsert_ids, new_revision):
        """Mirrors the expire-then-insert behavior of save_annotations()."""
        expire = {DATASET: dataset, REVISION_DELETED: {'$exists': False}}
        for identifier in upsert_ids:
            for doc in self.docs:
                if doc[IDENTIFIER] == identifier and self._matches(doc, expire):
                    doc[REVISION_DELETED] = new_revision
            self.docs.append(
                {IDENTIFIER: identifier, DATASET: dataset, REVISION_CREATED: new_revision}
            )

    def live_at(self, head):
        """Mirrors the visibility query in BaseItem.list()."""
        return sorted(
            doc[IDENTIFIER]
            for doc in self.docs
            if doc.get(REVISION_CREATED, 0) <= head
            and (REVISION_DELETED not in doc or doc[REVISION_DELETED] > head)
        )


@patch('dive_server.crud_annotation.GroupItem')
@patch('dive_server.crud_annotation.TrackItem')
@patch('dive_server.crud_annotation.RevisionLogItem')
def test_rollback_restored_track_survives_next_save(revision_log, track_item, _group_item):
    """
    A track deleted after the rollback target must stay restored once further
    edits are made.

    Revision 1 creates tracks a and b, revision 2 deletes a, revision 3 creates c.
    Rolling back to revision 1 restores a, but the restore is only real if a's
    tombstone is cleared: the next save re-issues revision 2, which would otherwise
    reactivate a stale rev_deleted=2 and drop the track again.
    """
    tracks = FakeCollection(
        [
            {IDENTIFIER: 'a', DATASET: 'dataset-id', REVISION_CREATED: 1, REVISION_DELETED: 2},
            {IDENTIFIER: 'b', DATASET: 'dataset-id', REVISION_CREATED: 1},
            {IDENTIFIER: 'c', DATASET: 'dataset-id', REVISION_CREATED: 3},
        ]
    )
    track_item.return_value = tracks

    crud_annotation.rollback({'_id': 'dataset-id'}, 1)

    # Truncating the revision log puts the head back at revision 1.
    assert tracks.live_at(1) == ['a', 'b']

    # An edit to an unrelated track allocates revision 2 again.
    tracks.save('dataset-id', upsert_ids=['b'], new_revision=2)
    assert tracks.live_at(2) == ['a', 'b']
