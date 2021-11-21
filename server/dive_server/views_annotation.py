from typing import List, Optional

import cherrypy
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType, TokenScope
from girder.models.folder import Folder

from dive_utils import setContentDisposition

from . import crud, crud_annotation

DatasetModelParam = {
    'description': "dataset id",
    'model': Folder,
    'paramType': 'query',
    'required': True,
}


class AnnotationResource(Resource):
    """RESTFul Annotation Resource"""

    def __init__(self, resourceName):
        super(AnnotationResource, self).__init__()
        self.resourceName = resourceName

        self.route("GET", (), self.get_annotations)
        self.route("GET", ("revision",), self.get_revisions)
        self.route("GET", ("export",), self.export)
        self.route("PATCH", (), self.save_annotations)
        self.route("DELETE", (), self.rollback)

    @access.user
    @autoDescribeRoute(
        Description("Get annotations of a dataset")
        .pagingParams("trackId", defaultLimit=0)
        .modelParam("folderId", **DatasetModelParam, level=AccessType.READ)
        .param('revision', 'revision', dataType='integer', required=False)
        .param(
            'contentDisposition',
            "inline or attachment",
            enum=['inline', 'attachment'],
            default='inline',
        )
    )
    def get_annotations(self, limit: int, offset: int, sort, folder, revision, contentDisposition):
        setContentDisposition(
            f'{folder["name"]}.dive.json', mime='text/csv', disposition=contentDisposition
        )
        cursor, total = crud_annotation.get_annotations(folder, limit, offset, sort, revision)
        cherrypy.response.headers['Girder-Total-Count'] = total
        return cursor

    @access.user
    @autoDescribeRoute(
        Description("Get dataset annotation revision log")
        .pagingParams("revision", defaultLimit=20)
        .modelParam("folderId", **DatasetModelParam, level=AccessType.READ)
    )
    def get_revisions(self, limit: int, offset: int, sort, folder):
        cursor, total = crud_annotation.get_revisions(folder, limit, offset, sort)
        cherrypy.response.headers['Girder-Total-Count'] = total
        return cursor

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @autoDescribeRoute(
        Description("Export annotations of a clip into CSV format.")
        .modelParam("folderId", **DatasetModelParam, level=AccessType.READ)
        .param(
            "excludeBelowThreshold",
            "Exclude tracks with confidencePairs below set threshold",
            paramType="query",
            dataType="boolean",
            default=False,
        )
        .jsonParam(
            "typeFilter",
            "List of track types to filter by",
            paramType="query",
            required=False,
            default=None,
            requireArray=True,
        )
    )
    def export(self, folder, excludeBelowThreshold: bool, typeFilter: Optional[List[str]]):
        crud.verify_dataset(folder)
        filename, gen = crud_annotation.get_annotation_csv_generator(
            folder,
            self.getCurrentUser(),
            excludeBelowThreshold=excludeBelowThreshold,
            typeFilter=typeFilter,
        )
        setContentDisposition(filename, mime='text/csv')
        return gen

    @access.user
    @autoDescribeRoute(
        Description("Update annotations")
        .modelParam("folderId", **DatasetModelParam, level=AccessType.WRITE)
        .jsonParam("tracks", "upsert and delete tracks", paramType="body", requireObject=True)
    )
    def save_annotations(self, folder, tracks):
        crud.verify_dataset(folder)
        validated: crud_annotation.AnnotationUpdateArgs = crud.get_validated_model(
            crud_annotation.AnnotationUpdateArgs, **tracks
        )
        upsert = [track.dict(exclude_none=True) for track in validated.upsert]
        user = self.getCurrentUser()
        return crud_annotation.save_annotations(folder, upsert, validated.delete, user)

    @access.user
    @autoDescribeRoute(
        Description("Rollback annotation revision")
        .modelParam("folderId", **DatasetModelParam, level=AccessType.WRITE)
        .param('revision', 'revision', dataType='integer')
    )
    def rollback(self, folder, revision):
        crud.verify_dataset(folder)
        crud_annotation.rollback(folder, revision)
