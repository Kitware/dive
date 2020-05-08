from girder.api import access
from girder.api.describe import Description, autoDescribeRoute, describeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.models.folder import Folder
from girder.models.item import Item

from viame_tasks.tasks import convert_images, convert_video, run_pipeline

from .model.attribute import Attribute
from .transforms import (
    GetPathFromFolderId,
    GetPathFromItemId,
    GirderUploadToFolder,
)
from .utils import (
    get_or_create_auxiliary_folder,
    move_existing_result_to_auxiliary_folder,
)


class Viame(Resource):
    def __init__(self, pipelines=[]):
        super(Viame, self).__init__()
        self.resourceName = "viame"
        self.pipelines = pipelines

        self.route("GET", ("pipelines",), self.get_pipelines)
        self.route("POST", ("pipeline",), self.run_pipeline_task)
        self.route("POST", ("conversion",), self.run_conversion_task)
        self.route("POST", ("image_conversion",), self.convert_folder_images)
        self.route("POST", ("attribute",), self.create_attribute)
        self.route("GET", ("attribute",), self.get_attributes)
        self.route("PUT", ("attribute", ":id"), self.update_attribute)
        self.route("DELETE", ("attribute", ":id"), self.delete_attribute)

    @access.user
    @describeRoute(Description("Get available pipelines"))
    def get_pipelines(self, params):
        return self.pipelines

    @access.user
    @autoDescribeRoute(
        Description("Run viame pipeline")
        .modelParam(
            "folderId",
            description="Folder id of a video clip",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
        .param(
            "pipeline",
            "Pipeline to run against the video",
            default="detector_simple_hough.pipe",
        )
    )
    def run_pipeline_task(self, folder, pipeline):
        user = self.getCurrentUser()
        move_existing_result_to_auxiliary_folder(folder, user)
        input_type = folder["meta"]["type"]
        result_metadata = {
            "detection": str(folder["_id"]),
            "pipeline": pipeline,
        }
        return run_pipeline.delay(
            GetPathFromFolderId(str(folder["_id"])),
            pipeline,
            input_type,
            girder_job_title=(
                "Running {} on {}".format(pipeline, str(folder["name"]))
            ),
            girder_result_hooks=[
                GirderUploadToFolder(
                    str(folder["_id"]), result_metadata, delete_file=True
                )
            ],
        )

    @access.user
    @autoDescribeRoute(
        Description("Convert video to a web friendly format").modelParam(
            "itemId",
            description="Item ID for a video",
            model=Item,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
    )
    def run_conversion_task(self, item):
        user = self.getCurrentUser()
        folder = Folder().findOne({"_id": item["folderId"]})
        auxiliary = get_or_create_auxiliary_folder(folder, user)
        upload_token = self.getCurrentToken()
        convert_video.delay(
            GetPathFromItemId(str(item["_id"])),
            str(item["folderId"]),
            str(upload_token["_id"]),
            auxiliary["_id"],
            girder_job_title=(
                "Converting {} to a web friendly format".format(
                    str(item["_id"])
                )
            ),
        )

    @access.user
    @autoDescribeRoute(
        Description(
            "Convert a folder of images into a web friendly format"
        ).modelParam(
            "folder",
            description="Folder containing the images to convert",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.WRITE,
        )
    )
    def convert_folder_images(self, folder):
        upload_token = self.getCurrentToken()
        convert_images.delay(
            folder["_id"],
            girder_client_token=str(upload_token["_id"]),
            girder_job_title=f"Converting {folder['_id']} to a web friendly format",
        )

    @access.user
    @autoDescribeRoute(
        Description("").jsonParam(
            "data", "", requireObject=True, paramType="body"
        )
    )
    def create_attribute(self, data, params):
        attribute = Attribute().create(
            data["name"], data["belongs"], data["datatype"], data["values"]
        )
        return attribute

    @access.user
    @autoDescribeRoute(Description(""))
    def get_attributes(self):
        return Attribute().find()

    @access.user
    @autoDescribeRoute(
        Description("")
        .modelParam("id", model=Attribute, required=True)
        .jsonParam("data", "", requireObject=True, paramType="body")
    )
    def update_attribute(self, data, attribute, params):
        if "_id" in data:
            del data["_id"]
        attribute.update(data)
        return Attribute().save(attribute)

    @access.user
    @autoDescribeRoute(
        Description("").modelParam("id", model=Attribute, required=True)
    )
    def delete_attribute(self, attribute, params):
        return Attribute().remove(attribute)
