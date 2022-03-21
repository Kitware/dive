from typing import Callable, Generator, Iterable, List, Optional, Tuple

from girder.constants import AccessType
from girder.models.folder import Folder
from pydantic import Field
from pydantic.main import BaseModel
import pymongo
from pymongo.cursor import Cursor

from dive_server import crud, crud_dataset
from dive_utils import constants, fromMeta, models, types
from dive_utils.serializers import viame

DATASET = 'dataset'
REVISION_DELETED = 'rev_deleted'
REVISION_CREATED = 'rev_created'
REVISION = 'revision'
IDENTIFIER = 'id'

DEFAULT_ANNOTATION_SORT = [[IDENTIFIER, 1]]
DEFAULT_REVISION_SORT = [[REVISION, pymongo.DESCENDING]]
ANNOTATION_INDICES = [
    # Index for finding tracks in a dataset
    [[(DATASET, 1), (IDENTIFIER, 1)], {}],
    # Index for ensuring uniqueness and dataset consistency
    [[(DATASET, 1), (IDENTIFIER, 1), (REVISION_CREATED, 1)], {'unique': True}],
]


class TrackItem(crud.PydanticModel):
    PROJECT_FIELDS = {
        **{'_id': 0},
        **{key: 1 for key in models.Track.schema()['properties'].keys()},
    }

    def initialize(self):
        self._indices = ANNOTATION_INDICES
        super().initialize("trackItem", models.TrackItemSchema)


class GroupItem(crud.PydanticModel):
    PROJECT_FIELDS = {
        **{'_id': 0},
        **{key: 1 for key in models.Group.schema()['properties'].keys()},
    }

    def initialize(self):
        self._indices = ANNOTATION_INDICES
        super().initialize("groupItem", models.GroupItemSchema)


class RevisionLogItem(crud.PydanticModel):
    PROJECT_FIELDS = {'_id': 0}

    def initialize(self):
        self._indices = [[[(DATASET, 1), (REVISION, 1)], {'unique': True}]]
        super().initialize("revisionLogItem", models.RevisionLog)


def get_last_revision(dsFolder: types.GirderModel):
    query = {DATASET: dsFolder['_id']}
    result = RevisionLogItem().findOne(query, sort=[[REVISION, pymongo.DESCENDING]]) or {}
    return result.get(REVISION, 0)  # Revision 0 is always the empty revision


def get_annotations(
    dsFolder: types.GirderModel,
    limit=0,
    offset=0,
    sort=DEFAULT_ANNOTATION_SORT,
    revision: Optional[int] = None,
) -> Tuple[Cursor, Cursor]:
    head = get_last_revision(dsFolder) if revision is None else revision
    query = {
        DATASET: dsFolder['_id'],
        REVISION_CREATED: {'$lte': head},
        '$or': [{REVISION_DELETED: {'$gt': head}}, {REVISION_DELETED: {'$exists': False}}],
    }
    annotation_cursor = TrackItem().find(
        offset=offset, limit=limit, sort=sort, query=query, fields=TrackItem.PROJECT_FIELDS
    )
    group_cursor = GroupItem().find(
        offset=offset, limit=limit, sort=sort, query=query, fields=GroupItem.PROJECT_FIELDS
    )
    return annotation_cursor, group_cursor


def get_revisions(
    dsFolder: types.GirderModel,
    limit=0,
    offset=0,
    sort=DEFAULT_REVISION_SORT,
    before: Optional[int] = None,
):
    query: dict = {DATASET: dsFolder['_id']}
    if before is not None:
        query[REVISION] = {'$lte': before}
    cursor = RevisionLogItem().find(
        offset=offset, limit=limit, sort=sort, query=query, fields=RevisionLogItem.PROJECT_FIELDS
    )
    total = RevisionLogItem().find(query=query).count()
    return cursor, total


def rollback(dsFolder: types.GirderModel, revision: int):
    """Reset to previous revision."""
    # TODO implement immutabble forward-rollback (like git revert)
    # Logic: delete everything created after revision
    # And erase deletions for anything deleted after revision
    dsId = dsFolder['_id']
    RevisionLogItem().removeWithQuery({DATASET: dsId, REVISION: {'$gt': revision}})
    removeQuery = {DATASET: dsId, REVISION_CREATED: {'$gt': revision}}
    updateQuery = {DATASET: dsId, REVISION_DELETED: {'$gt': revision}}, {
        '$unset': {REVISION_DELETED: ""}
    }
    TrackItem().removeWithQuery(removeQuery)
    TrackItem().update(updateQuery)
    GroupItem().removeWithQuery(removeQuery)
    GroupItem().update(updateQuery)


def get_annotation_csv_generator(
    folder: types.GirderModel,
    user: types.GirderUserModel,
    excludeBelowThreshold=False,
    typeFilter=None,
    revision=None,
) -> Tuple[str, Callable[[], Generator[str, None, None]]]:
    """Get the annotation generator for a folder"""
    fps = None
    imageFiles = None

    source_type = fromMeta(folder, constants.TypeMarker)
    if source_type == constants.VideoType:
        fps = fromMeta(folder, constants.FPSMarker)
    elif source_type == constants.ImageSequenceType:
        imageFiles = [img['name'] for img in crud.valid_images(folder, user)]

    thresholds = fromMeta(folder, "confidenceFilters", {})

    def downloadGenerator():
        datalist, _ = get_annotations(folder, revision=revision)
        for data in viame.export_tracks_as_csv(
            datalist,
            excludeBelowThreshold,
            thresholds=thresholds,
            filenames=imageFiles,
            fps=fps,
            typeFilter=typeFilter,
            revision=revision,
        ):
            yield data

    filename = folder["name"] + ".csv"
    return filename, downloadGenerator


class TrackUpdateArgs(BaseModel):
    delete: List[int] = []
    upsert: List[models.Track] = []


class GroupUpdateArgs(BaseModel):
    delete: List[int] = []
    upsert: List[models.Group] = []


class AnnotationUpdateArgs(BaseModel):
    tracks: TrackUpdateArgs = Field(default_factory=TrackUpdateArgs)
    groups: GroupUpdateArgs = Field(default_factory=GroupUpdateArgs)

    class Config:
        extra = 'ignore'


def save_annotations(
    dsFolder: types.GirderModel,
    user: types.GirderUserModel,
    upsert_tracks: Iterable[dict] = [],
    delete_tracks: Iterable[int] = [],
    upsert_groups: Iterable[dict] = [],
    delete_groups: Iterable[int] = [],
    description="save",
    overwrite=False,
):
    """
    Annotations are lazy-deleted by marking their staleness property as true.
    """
    datasetId = dsFolder['_id']
    new_revision = get_last_revision(dsFolder) + 1
    delete_annotation_update = {'$set': {REVISION_DELETED: new_revision}}

    def update_collection(
        collection: crud.PydanticModel,
        upsert_list: Iterable[dict],
        delete_list: Iterable[int],
    ):
        expire_operations = []  # Mark existing records as deleted
        expire_result = {}
        insert_operations = []  # Insert new records
        insert_result = {}

        if overwrite:
            query = {DATASET: datasetId, REVISION_DELETED: {'$exists': False}}
            expire_result = collection.collection.bulk_write(
                [pymongo.UpdateMany(query, delete_annotation_update)]
            ).bulk_api_result

        for id in delete_list:
            filter = {IDENTIFIER: id, DATASET: datasetId, REVISION_DELETED: {'$exists': False}}
            # UpdateMany for safety, UpdateOne would also work
            expire_operations.append(pymongo.UpdateMany(filter, delete_annotation_update))

        for newdict in upsert_list:
            newdict.update({DATASET: datasetId, REVISION_CREATED: new_revision})
            newdict.pop(REVISION_DELETED, None)
            filter = {
                IDENTIFIER: newdict[IDENTIFIER],
                DATASET: datasetId,
                REVISION_DELETED: {'$exists': False},
            }
            if not overwrite:
                # UpdateMany for safety, UpdateOne would also work
                expire_operations.append(pymongo.UpdateMany(filter, delete_annotation_update))
            insert_operations.append(pymongo.InsertOne(newdict))

        # Ordered=false allows fast parallel writes
        if len(expire_operations):
            expire_result = collection.collection.bulk_write(
                expire_operations, ordered=False
            ).bulk_api_result
        if len(insert_operations):
            insert_result = collection.collection.bulk_write(
                insert_operations, ordered=False
            ).bulk_api_result

        additions = insert_result.get('nInserted', 0)
        deletions = expire_result.get('nModified', 0)
        return additions, deletions

    track_additions, track_deletions = update_collection(TrackItem(), upsert_tracks, delete_tracks)
    group_additions, group_deletions = update_collection(GroupItem(), upsert_groups, delete_groups)
    additions = track_additions + group_additions
    deletions = track_deletions + group_deletions

    if additions or deletions:
        # Write the revision to the log
        log_entry = models.RevisionLog(
            dataset=datasetId,
            author_name=user['login'],
            author_id=user['_id'],
            revision=new_revision,
            additions=additions,
            deletions=deletions,
            description=description,
        )
        RevisionLogItem().create(log_entry)

    return {"updated": additions, "deleted": deletions}


def clone_annotations(
    source: types.GirderModel,
    dest: types.GirderModel,
    user: types.GirderUserModel,
    revision: Optional[int] = None,
):
    track_iter, group_iter = get_annotations(source, revision=revision)
    save_annotations(
        dest,
        user,
        upsert_tracks=track_iter,
        upsert_groups=group_iter,
        description="initialize clone",
    )


def get_labels(user: types.GirderUserModel):
    """Find all the labels in all datasets belonging to the user"""
    pipeline = [
        {
            '$match': crud_dataset.get_dataset_query(
                user, published=False, shared=False, level=AccessType.WRITE
            )
        },
        {
            '$lookup': {
                'from': 'trackItem',
                'let': {'dataset_id': '$_id'},
                'as': 'label',
                'pipeline': [
                    {'$match': {'$expr': {'$eq': ['$dataset', '$$dataset_id']}}},
                    {'$match': {'$expr': {'$eq': [{'$type': "$rev_deleted"}, 'missing']}}},
                    {'$project': {'confidencePairs': 1}},
                    {'$set': {'confidencePairs': {'$first': '$confidencePairs'}}},
                    {'$set': {'confidencePairs': {'$first': '$confidencePairs'}}},
                ],
            },
        },
        {'$unwind': '$label'},
        {'$set': {'label': '$label.confidencePairs'}},
        {'$project': {'label': 1, 'name': 1}},
        {'$group': {'_id': '$label', 'count': {'$count': {}}}},
        {'$sort': {'_id': 1}},
    ]
    return Folder().collection.aggregate(pipeline)
