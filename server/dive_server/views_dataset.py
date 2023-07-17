from typing import List, Optional

import cherrypy
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource, rawResponse
from girder.constants import AccessType, SortDir, TokenScope
from girder.exceptions import RestException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item

from dive_utils import constants, setContentDisposition
from dive_utils.models import MetadataMutable

from . import crud, crud_dataset

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

        # Expose clone identifier
        Folder().exposeFields(AccessType.READ, constants.ForeignMediaIdMarker)

        self.route("POST", (), self.create_dataset)
        self.route("GET", (), self.list_datasets)
        self.route("GET", (":id",), self.get_meta)
        self.route("GET", (":id", "media"), self.get_media)
        self.route("GET", ("export",), self.export)
        self.route("GET", (":id", "configuration"), self.get_configuration)
        self.route("GET", (":id", "media", ":mediaId", "download"), self.download_media)
        self.route("POST", ("validate_files",), self.validate_files)

        self.route("PATCH", (":id",), self.patch_metadata)

        # do we make this another resource in girder?
        self.route("PATCH", (":id", "attributes"), self.patch_attributes)
        self.route("PATCH", (":id", "attribute_track_filters"), self.patch_attribute_track_filters)

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
            required=True,
        )
        .param(
            "revision",
            "Revision ID to use for clone source",
            paramType="query",
            dataType="integer",
            default=None,
            required=False,
        )
    )
    def create_dataset(self, cloneSource, parentFolder, name, revision):
        # TODO: make this endpoint do regular creation and clone
        return crud_dataset.createSoftClone(
            self.getCurrentUser(), cloneSource, parentFolder, name, revision
        )

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @autoDescribeRoute(
        Description("Download a media file")
        .modelParam(
            "id",
            level=AccessType.READ,
            **DatasetModelParam,
        )
        .modelParam(
            "mediaId",
            description="media id",
            model=Item,
            paramType='path',
            level=AccessType.READ,
            required=True,
            force=True,
        )
    )
    def download_media(self, folder, item):
        root = crud.getCloneRoot(self.getCurrentUser(), folder)
        if item["folderId"] == root["_id"]:
            files = list(Item().childFiles(item))
            if len(files) != 1:
                raise RestException('Expected one file', code=400)
            file = files[0]
            rangeHeader = cherrypy.lib.httputil.get_ranges(
                cherrypy.request.headers.get('Range'), file.get('size', 0)
            )
            # The HTTP Range header takes precedence over query params
            offset, endByte = (0, None)
            if rangeHeader and len(rangeHeader):
                # Currently we only support a single range.
                offset, endByte = rangeHeader[0]
            return File().download(file, offset, endByte=endByte)
        else:
            raise RestException('Media is not found', code=404)

    @access.user
    @autoDescribeRoute(
        Description("List datasets in the system")
        .pagingParams("created", defaultSortDir=SortDir.DESCENDING)
        .param(
            constants.PublishedMarker,
            'Return only published datasets',
            required=False,
            default=False,
            dataType='boolean',
        )
        .param(
            constants.SharedMarker,
            'Return only datasets shared with me',
            required=False,
            default=False,
            dataType='boolean',
        )
    )
    def list_datasets(
        self,
        limit: int,
        offset: int,
        sort,
        published: bool,
        shared: bool,
    ):
        return crud_dataset.list_datasets(
            self.getCurrentUser(),
            published,
            shared,
            limit,
            offset,
            sort,
        )

    @access.user
    @autoDescribeRoute(
        Description("Get dataset metadata").modelParam(
            "id", level=AccessType.READ, **DatasetModelParam
        )
    )
    def get_meta(self, folder):
        return crud_dataset.get_dataset(folder, self.getCurrentUser()).dict(exclude_none=True)

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @rawResponse
    @autoDescribeRoute(
        Description("Get dataset configuration").modelParam(
            "id", level=AccessType.READ, **DatasetModelParam
        )
    )
    def get_configuration(self, folder):
        setContentDisposition(f'{folder["name"]}.config.json')
        # A dataset configuration consists of MetadataMutable properties.
        expose = MetadataMutable.schema()['properties'].keys()
        return crud_dataset.get_dataset(folder, self.getCurrentUser()).json(
            exclude_none=True,
            include=expose,
            indent=2,
        )

    @access.user
    @autoDescribeRoute(
        Description("Get dataset source media").modelParam(
            "id", level=AccessType.READ, **DatasetModelParam
        )
    )
    def get_media(self, folder):
        return crud_dataset.get_media(folder, self.getCurrentUser()).dict(exclude_none=True)

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @autoDescribeRoute(
        Description("Export all selected datasets")
        .jsonParam(
            "folderIds",
            "List of track types to filter by",
            paramType="query",
            required=True,
            default=[],
            requireArray=True,
        )
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
            default=None,
            requireArray=True,
        )
    )
    def export(
        self,
        folderIds: List[str],
        includeMedia: bool,
        includeDetections: bool,
        excludeBelowThreshold: bool,
        typeFilter: Optional[List[str]],
    ):
        girder_folders = []
        for folder in folderIds:
            girder_folders.append(
                Folder().load(folder, level=AccessType.READ, user=self.getCurrentUser())
            )
        gen = crud_dataset.export_datasets_zipstream(
            girder_folders,
            self.getCurrentUser(),
            includeMedia=includeMedia,
            includeDetections=includeDetections,
            excludeBelowThreshold=excludeBelowThreshold,
            typeFilter=typeFilter,
        )
        zip_name = "batch_export.zip"
        if len(girder_folders) == 1:
            zip_name = f"{girder_folders[0]['name']}.zip"
        setContentDisposition(zip_name, mime='application/zip')
        return gen

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
            description="schema: MetadataMutableUpdateArgs",
            requireObject=True,
            paramType="body",
        )
    )
    def patch_metadata(self, folder, data):
        return crud_dataset.update_metadata(folder, data)

    @access.user
    @autoDescribeRoute(
        Description("Update set of possible attributes")
        .modelParam("id", level=AccessType.WRITE, **DatasetModelParam)
        .jsonParam(
            "data",
            description="schema: AttributeUpdateArgs",
            requireObject=True,
            paramType="body",
        )
    )
    def patch_attributes(self, folder, data):
        return crud_dataset.update_attributes(folder, data)

    @access.user
    @autoDescribeRoute(
        Description("Update set of possible attributes")
        .modelParam("id", level=AccessType.WRITE, **DatasetModelParam)
        .jsonParam(
            "data",
            description="schema: AttributeTrackFilterUpdateArgs",
            requireObject=True,
            paramType="body",
        )
    )
    def patch_attribute_track_filters(self, folder, data):
        return crud_dataset.update_attribute_track_filters(folder, data)
