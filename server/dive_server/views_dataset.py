from typing import List

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource, setContentDisposition, setResponseHeader
from girder.constants import AccessType, TokenScope
from girder.models.folder import Folder

from dive_utils import constants

from . import crud_dataset

DatasetModelParam = {
    'description': "dataset id",
    'model': Folder,
    'paramType': 'path',
    'required': True,
}


class DatasetResource(Resource):
    """RESTful Dataset resource"""

    def __init__(self, resourceName):
        super(DatasetResource, self).__init__()
        self.resourceName = resourceName

        self.route("POST", (), self.create_dataset)

        self.route("GET", (), self.list_datasets)
        self.route("GET", (":id",), self.get_meta)
        self.route("GET", (":id", "export"), self.export)
        self.route("GET", ("validate_files",), self.validate_files)

        self.route("PATCH", (":id", "metadata"), self.patch_metadata)
        self.route("PATCH", (":id", "attributes"), self.patch_attributes)

    @access.user
    @autoDescribeRoute(
        Description("Create a new dataset")
        .modelParam(
            "cloneId",
            description="Create dataset from clone source",
            paramType="query",
            destName="cloneSource",
            model=Folder,
            level=AccessType.READ,
            required=True,
        )
        .modelParam(
            "parentFolderId",
            description="Parent folder",
            paramType="query",
            destName="parentFolder",
            model=Folder,
            level=AccessType.WRITE,
            required=True,
        )
        .param(
            "name",
            "Name for new dataset",
            paramType="query",
            dataType="string",
            default=None,
            required=False,
        )
    )
    def create_dataset(self, cloneSource, parentFolder, name):
        # TODO: make this endpoint do regular creation and clone
        return crud_dataset.createSoftClone(self.getCurrentUser(), cloneSource, parentFolder, name)

    @access.user
    @autoDescribeRoute(
        Description("List datasets in the system")
        .pagingParams("created")
        .param(
            constants.PublishedMarker,
            'Return only published datasets',
            required=False,
            default=False,
            dataType='boolean',
        )
    )
    def list_datasets(self, params):
        limit, offset, sort = self.getPagingParameters(params)
        return crud_dataset.list_datasets(
            self.getCurrentUser(),
            self.boolParam(constants.PublishedMarker, params),
            limit,
            offset,
            sort,
        )

    @access.user
    @autoDescribeRoute(
        Description("Get dataset metadata").modelParam(
            "id", level=AccessType.READ, **DatasetModelParam
        )
        # TODO add a "camera" query param
    )
    def get_meta(self, folder):
        return crud_dataset.get_dataset(folder, self.getCurrentUser()).dict(exclude_none=True)

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @autoDescribeRoute(
        Description("Export everything in a dataset")
        .modelParam("id", level=AccessType.READ, **DatasetModelParam)
        .param(
            "includeMedia",
            "Include media content",
            paramType="query",
            dataType="boolean",
            default=True,
        )
        .param(
            "includeDetections",
            "Include annotation content",
            paramType="query",
            dataType="boolean",
            default=True,
        )
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
    def export(
        self,
        folder,
        includeMedia: bool,
        includeDetections: bool,
        excludeBelowThreshold: bool,
        typeFilter: List[str],
    ):
        setResponseHeader('Content-Type', 'application/zip')
        setContentDisposition(folder['name'] + '.zip')
        return crud_dataset.export_dataset_zipstream(
            folder,
            self.getCurrentUser(),
            includeMedia=includeMedia,
            includeDetections=includeDetections,
            excludeBelowThreshold=excludeBelowThreshold,
            typeFilter=typeFilter,
        )

    @access.user
    @autoDescribeRoute(
        Description("Test whether or not a set of files are safe to upload").jsonParam(
            "files", "", paramType="body", requireArray=True
        )
    )
    def validate_files(self, files):
        return crud_dataset.validate_files(files)

    @access.user
    @autoDescribeRoute(
        Description("Update mutable metadata fields")
        .modelParam("id", level=AccessType.WRITE, **DatasetModelParam)
        .jsonParam(
            "data",
            description="JSON with the metadata to set",
            requireObject=True,
            paramType="body",
        )
    )
    def patch_metadata(self, folder, data):
        return crud_dataset.update_dataset(folder, data)

    @access.user
    @autoDescribeRoute(
        Description("Update set of possible attributes")
        .modelParam("id", level=AccessType.WRITE, **DatasetModelParam)
        .jsonParam(
            "data",
            description="upsert and delete",
            requireObject=True,
            paramType="body",
        )
    )
    def patch_attributes(self, folder, data):
        return crud_dataset.update_attributes(folder, data)
