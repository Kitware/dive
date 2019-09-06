import datetime

from girder import events, plugin
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.models.user import User
from girder.models.folder import Folder
from girder.utility import server


from .client_webroot import ClientWebroot
from viame_tasks.tasks import run_pipeline, convert_video
from .transforms import GirderItemId, GirderUploadToFolder
from .viame_detection import ViameDetection


class Viame(Resource):
    def __init__(self):
        super(Viame, self).__init__()
        self.resourceName = 'viame'
        self.route("POST", ("pipeline", ), self.run_pipeline_task)

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
        videos = Folder().createFolder(public, 'Videos', reuseExisting=True)
        metadata = {'itemId': itemId, 'pipeline': pipeline}
        upload_token = self.getCurrentToken()
        convert_video.delay(
            GirderItemId(itemId),
            itemId,
            str(upload_token["_id"]),
            girder_job_title=("Converting {} to a web friendly format".format(itemId))
        )
        run_pipeline.delay(
            GirderItemId(itemId),
            pipeline,
            girder_job_title=("Runnin {} on {}".format(pipeline, itemId)),
            girder_result_hooks=[
                GirderUploadToFolder(str(results['_id']), metadata, delete_file=True)
            ]
        )


class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):
        info['apiRoot'].viame = Viame()
        info['apiRoot'].viame_detection = ViameDetection()
        # Relocate Girder
        info['serverRoot'], info['serverRoot'].girder = (ClientWebroot(),
                                                         info['serverRoot'])
        info['serverRoot'].api = info['serverRoot'].girder.api
