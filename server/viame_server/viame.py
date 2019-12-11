from girder.api import access
from girder.constants import AccessType
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.user import User
from viame_tasks.tasks import run_pipeline, convert_video

from .transforms import GirderItemId, GirderUploadToFolder
from .model.attribute import Attribute
from .utils import get_or_create_auxiliary_folder


class Viame(Resource):
    def __init__(self):
        super(Viame, self).__init__()
        self.resourceName = 'viame'
        self.route("POST", ("pipeline", ), self.run_pipeline_task)
        self.route("POST", ("conversion", ), self.run_conversion_task)
        self.route("POST", ("attribute", ), self.create_attribute)
        self.route("GET", ("attribute", ), self.get_attributes)
        self.route("PUT", ("attribute", ":id"), self.update_attribute)
        self.route("DELETE", ("attribute", ":id"), self.delete_attribute)

    @access.user
    @autoDescribeRoute(
        Description("Run viame pipeline")
        .modelParam("itemId", description="Item ID for a video", model=Item, paramType='query', required=True, level=AccessType.READ)
        .param("pipeline", "Pipeline to run against the video", default="detector_simple_hough.pipe")
    )
    def run_pipeline_task(self, item, pipeline):
        user = self.getCurrentUser()
        results = get_or_create_auxiliary_folder(item, user)
        metadata = {'itemId': str(item["_id"]), 'pipeline': pipeline}
        run_pipeline.delay(
            GirderItemId(str(item["_id"])),
            pipeline,
            girder_job_title=("Runnin {} on {}".format(pipeline, str(item["_id"]))),
            girder_result_hooks=[
                GirderUploadToFolder(str(results['_id']), metadata, delete_file=True)
            ]
        )

    @access.user
    @autoDescribeRoute(
        Description("Convert video to a web friendly format")
        .modelParam("itemId", description="Item ID for a video", model=Item, paramType='query', required=True, level=AccessType.READ)
    )
    def run_conversion_task(self, item):
        user = self.getCurrentUser()
        videos = get_or_create_auxiliary_folder(item, user)
        upload_token = self.getCurrentToken()
        convert_video.delay(
            GirderItemId(str(item["_id"])),
            str(item["_id"]),
            str(upload_token["_id"]),
            videos['_id'],
            girder_job_title=("Converting {} to a web friendly format".format(str(item["_id"])))
        )

    @access.user
    @autoDescribeRoute(
        Description("")
        .jsonParam('data', '', requireObject=True, paramType='body')
    )
    def create_attribute(self, data, params):
        attribute = Attribute().create(
            data['name'], data['belongs'], data['datatype'], data['values'])
        return attribute

    @access.user
    @autoDescribeRoute(
        Description("")
    )
    def get_attributes(self):
        return Attribute().find()

    @access.user
    @autoDescribeRoute(
        Description("")
        .modelParam('id', model=Attribute, required=True)
        .jsonParam('data', '', requireObject=True, paramType='body')
    )
    def update_attribute(self, data, attribute, params):
        if "_id" in data:
            del data["_id"]
        attribute.update(data)
        return Attribute().save(attribute)

    @access.user
    @autoDescribeRoute(
        Description("")
        .modelParam('id', model=Attribute, required=True)
    )
    def delete_attribute(self, attribute, params):
        return Attribute().remove(attribute)
