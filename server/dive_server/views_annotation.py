import json
from typing import List, Optional

import cherrypy
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource, setRawResponse
from girder.constants import AccessType, TokenScope
from girder.exceptions import RestException
from girder.models.folder import Folder

from dive_utils import constants, setContentDisposition

from . import crud, crud_annotation

DatasetModelParam = {
    'description': "dataset id",
    'model': Folder,
    'paramType': 'query',
    'required': True,
}


GetAnnotationParams = (
    Description("Get annotations of a dataset")
    .pagingParams("id", defaultLimit=0)
    .modelParam("folderId", **DatasetModelParam, level=AccessType.READ)
    .param('revision', 'revision', dataType='integer', required=False)
    .param('tag', 'tag', dataType='string', required=False)
)


class AnnotationResource(Resource):
    """RESTFul Annotation Resource"""

    def __init__(self, resourceName):
        super(AnnotationResource, self).__init__()
        self.resourceName = resourceName

        self.route("GET", ("track",), self.get_tracks)
        self.route("GET", ("group",), self.get_groups)
        self.route("GET", ("revision",), self.get_revisions)
        self.route("GET", ("export",), self.export)
        self.route("GET", ("labels",), self.get_labels)
        self.route("GET", ("tags",), self.get_tags)
        self.route("PATCH", (), self.save_annotations)
        self.route("POST", ("rollback",), self.rollback)

    @access.user
    @autoDescribeRoute(GetAnnotationParams)
    def get_tracks(self, limit: int, offset: int, sort, folder, revision, tag):
        return crud_annotation.TrackItem().list(
            folder, limit=limit, offset=offset, sort=sort, revision=revision, tag=tag
        )

    @access.user
    @autoDescribeRoute(GetAnnotationParams)
    def get_groups(self, limit: int, offset: int, sort, folder, revision, tag):
        return crud_annotation.GroupItem().list(
            folder, limit=limit, offset=offset, sort=sort, revision=revision, tag=tag
        )

    @access.user
    @autoDescribeRoute(
        Description("Get dataset annotation revision log")
        .pagingParams("revision", defaultLimit=20)
        .modelParam("folderId", **DatasetModelParam, level=AccessType.READ)
        .param(
            "tag",
            "Custom tag for any annotations that are loaded",
            paramType="query",
            dataType="string",
            default='',
            required=False,
        )
    )
    def get_revisions(self, limit: int, offset: int, sort, folder, tag):
        print(f'TAG:::::{tag}')
        cursor, total = crud_annotation.RevisionLogItem().list(
            folder, limit, offset, sort, None, tag
        )
        cherrypy.response.headers['Girder-Total-Count'] = total
        return cursor

    @access.user
    @autoDescribeRoute(
        Description("Get dataset annotation revision log")
        .pagingParams("revision", defaultLimit=20)
        .modelParam("folderId", **DatasetModelParam, level=AccessType.READ)
    )
    def get_tags(self, limit: int, offset: int, sort, folder):
        cursor = crud_annotation.RevisionLogItem().tags(folder, limit, offset, sort)
        return cursor

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @autoDescribeRoute(
        Description("Export annotations of a clip into CSV format.")
        .modelParam("folderId", **DatasetModelParam, level=AccessType.READ)
        .param(
            "excludeBelowThreshold",
            "Exclude tracks with confidencePairs below set threshold.",
            paramType="query",
            dataType="boolean",
            default=False,
        )
        .param(
            "revisionId",
            "Optional revision to export from.  Default is latest.",
            paramType="query",
            dataType="integer",
            default=None,
            required=False,
        )
        .param(
            'format',
            'Optional export format.',
            paramType='query',
            dataType='string',
            default='viame_csv',
            enum=['viame_csv', 'dive_json'],
            required=False,
        )
        .jsonParam(
            "typeFilter",
            "List of track types to filter by.  Default is no filtering.",
            paramType="query",
            required=False,
            default=None,
            requireArray=True,
        )
    )
    def export(
        self,
        folder,
        excludeBelowThreshold: bool,
        revisionId: int,
        format: str,
        typeFilter: Optional[List[str]],
    ):
        crud.verify_dataset(folder)

        if format == 'viame_csv':
            filename, gen = crud_annotation.get_annotation_csv_generator(
                folder,
                self.getCurrentUser(),
                excludeBelowThreshold=excludeBelowThreshold,
                typeFilter=typeFilter,
                revision=revisionId,
            )
            setContentDisposition(filename, mime='text/csv')
            return gen
        elif format == 'dive_json':
            setContentDisposition(f'{folder["name"]}.dive.json', mime='application/json')
            setRawResponse()
            annotations = crud_annotation.get_annotations(folder, revision=revisionId)
            return json.dumps(annotations).encode('utf-8')
        else:
            raise RestException(f'Format {format} is not a valid option.')

    @access.user
    @autoDescribeRoute(
        Description("Update annotations")
        .modelParam("folderId", **DatasetModelParam, level=AccessType.WRITE)
        .jsonParam("body", "upsert and delete tracks", paramType="body", requireObject=True)
    )
    def save_annotations(self, folder, body, tag=None):
        crud.verify_dataset(folder)
        validated: crud_annotation.AnnotationUpdateArgs = crud.get_validated_model(
            crud_annotation.AnnotationUpdateArgs, **body
        )
        upsert_tracks = [track.dict(exclude_none=True) for track in validated.tracks.upsert]
        upsert_groups = [group.dict(exclude_none=True) for group in validated.groups.upsert]
        user = self.getCurrentUser()
        return crud_annotation.save_annotations(
            folder,
            user,
            upsert_tracks=upsert_tracks,
            delete_tracks=validated.tracks.delete,
            upsert_groups=upsert_groups,
            delete_groups=validated.groups.delete,
            tag=validated.tag,
        )

    @access.user
    @autoDescribeRoute(
        Description("Rollback annotation revision to the specified version")
        .modelParam("folderId", **DatasetModelParam, level=AccessType.WRITE)
        .param('revision', 'revision', dataType='integer')
    )
    def rollback(self, folder, revision):
        crud.verify_dataset(folder)
        crud_annotation.rollback(folder, revision)

    @access.user
    @autoDescribeRoute(
        Description("Get all labels visible to a particular user")
        .param(
            constants.PublishedMarker,
            'Return only labels from published data',
            required=False,
            default=True,
            dataType='boolean',
        )
        .param(
            constants.SharedMarker,
            'Return only labels from data shared with me',
            required=False,
            default=True,
            dataType='boolean',
        )
    )
    def get_labels(self, published: bool, shared: bool):
        return crud_annotation.get_labels(self.getCurrentUser(), published=published, shared=shared)
