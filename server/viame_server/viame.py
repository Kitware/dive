from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.models.user import User
from girder.models.folder import Folder
from viame_tasks.tasks import run_pipeline, convert_video

from .transforms import GirderItemId, GirderUploadToFolder
from .model.attribute import Attribute


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
        .param("itemId", "Item ID for a video")
        .param("pipeline", "Pipeline to run against the video", default="detector_simple_hough.pipe")
    )
    def run_pipeline_task(self, itemId, pipeline):
        user = self.getCurrentUser()
        public = Folder().findOne({'parentId': user['_id'], 'name': 'Public'})
        results = Folder().createFolder(public, 'Results', reuseExisting=True)
        metadata = {'itemId': itemId, 'pipeline': pipeline}
        run_pipeline.delay(
            GirderItemId(itemId),
            pipeline,
            girder_job_title=("Runnin {} on {}".format(pipeline, itemId)),
            girder_result_hooks=[
                GirderUploadToFolder(str(results['_id']), metadata, delete_file=True)
            ]
        )

    @access.user
    @autoDescribeRoute(
        Description("Convert video to a web friendly format")
        .param("itemId", "Item ID for a video")
    )
    def run_conversion_task(self, itemId):
        user = self.getCurrentUser()
        public = Folder().findOne({'parentId': user['_id'], 'name': 'Public'})
        videos = Folder().createFolder(public, 'Videos', reuseExisting=True)
        upload_token = self.getCurrentToken()
        convert_video.delay(
            GirderItemId(itemId),
            itemId,
            str(upload_token["_id"]),
            videos['_id'],
            girder_job_title=("Converting {} to a web friendly format".format(itemId))
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
