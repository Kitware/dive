from typing import List

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource, setContentDisposition, setResponseHeader
from girder.constants import AccessType, TokenScope
from girder.models.folder import Folder

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
        self.route("GET", ("export",), self.export)

        self.route("PATCH", (), self.save_annotations)

    @access.user
    @autoDescribeRoute(
        Description("Get annotations of a clip").modelParam(
            "folderId", **DatasetModelParam, level=AccessType.READ
        )
    )
    def get_annotations(self, folder):
        return crud_annotation.get_annotations(folder)

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
            default=[],
            requireArray=True,
        )
    )
    def export(self, folder, excludeBelowThreshold: bool, typeFilter: List[str]):
        filename, gen = crud.get_annotation_csv_generator(
            folder,
            self.getCurrentUser(),
            excludeBelowThreshold=excludeBelowThreshold,
            typeFilter=typeFilter,
        )
        setResponseHeader('Content-Type', 'application/zip')
        setContentDisposition(filename)
        return gen

    @access.user
    @autoDescribeRoute(
        Description("")
        .modelParam("folderId", **DatasetModelParam, level=AccessType.WRITE)
        .jsonParam("tracks", "upsert and delete tracks", paramType="body", requireObject=True)
    )
    def save_annotations(self, folder, tracks):
        return crud_annotation.save_annotations(folder, self.getCurrentUser(), tracks)
