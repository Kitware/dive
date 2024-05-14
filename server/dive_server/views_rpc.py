from typing import List

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.token import Token

from dive_utils import asbool, fromMeta
from dive_utils.constants import DatasetMarker, FPSMarker, MarkForPostProcess, TypeMarker
from dive_utils.types import PipelineDescription

from . import crud, crud_rpc


class RpcResource(Resource):
    """Remote procedure calls to celery and other non-RESTful operations"""

    def __init__(self, resourceName):
        super(RpcResource, self).__init__()
        self.resourceName = resourceName

        self.route("POST", ("pipeline",), self.run_pipeline_task)
        self.route("POST", ("train",), self.run_training)
        self.route("POST", ("postprocess", ":id"), self.postprocess)
        self.route("POST", ("convert_dive", ":id"), self.convert_dive)
        self.route("POST", ("convert_large_image", ":id"), self.convert_large_image)
        self.route("POST", ("batch_postprocess", ":id"), self.batch_postprocess)

    @access.user
    @autoDescribeRoute(
        Description("Run viame pipeline")
        .modelParam(
            "folderId",
            description="Folder id of a video clip",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.WRITE,
        )
        .jsonParam("pipeline", "The pipeline to run on the dataset", required=True)
    )
    def run_pipeline_task(self, folder, pipeline: PipelineDescription):
        return crud_rpc.run_pipeline(self.getCurrentUser(), folder, pipeline)

    @access.user
    @autoDescribeRoute(
        Description("Run training on a folder")
        .jsonParam(
            "body",
            description="JSON object with Array of folderIds to run training on\
             and labels.txt file content",
            paramType="body",
            schema={"folderIds": List[str], "labelText": str},
        )
        .param(
            "pipelineName",
            description="The name of the resulting pipeline",
            paramType="query",
            required=True,
        )
        .param(
            "config",
            description="The configuration to use for training",
            paramType="query",
            required=True,
        )
        .param(
            "annotatedFramesOnly",
            description="Train only using frames with annotations",
            paramType="query",
            dataType="boolean",
            default=False,
            required=False,
        )
    )
    def run_training(self, body, pipelineName, config, annotatedFramesOnly):
        user = self.getCurrentUser()
        token = Token().createToken(user=user, days=14)
        run_training_args = crud.get_validated_model(crud_rpc.RunTrainingArgs, **body)
        return crud_rpc.run_training(
            user, token, run_training_args, pipelineName, config, annotatedFramesOnly
        )

    @access.user
    @autoDescribeRoute(
        Description("Post-processing to be run after media/annotation import")
        .modelParam(
            "id",
            description="Folder containing the items to process",
            model=Folder,
            level=AccessType.WRITE,
        )
        .param(
            "skipJobs",
            "Whether to skip processing that might dispatch worker jobs",
            paramType="formData",
            dataType="boolean",
            default=False,
            required=False,
        )
        .param(
            "skipTranscoding",
            "Whether to skip processing that might dispatch worker jobs",
            paramType="formData",
            dataType="boolean",
            default=False,
            required=False,
        )
        .param(
            "additive",
            "Whether to add new annotations to existing ones",
            paramType="formData",
            dataType="boolean",
            default=False,
            required=False,
        )
        .param(
            "additivePrepend",
            "When using additive the prepend to types: 'prepend_type'",
            paramType="formData",
            dataType="string",
            default='',
            required=False,
        )
        .param(
            "set",
            "Custom set name for any annotations that are loaded",
            paramType="formData",
            dataType="string",
            default='',
            required=False,
        )
    )
    def postprocess(self, folder, skipJobs, skipTranscoding, additive, additivePrepend, set):
        return crud_rpc.postprocess(
            self.getCurrentUser(), folder, skipJobs, skipTranscoding, additive, additivePrepend, set
        )

    @access.user
    @autoDescribeRoute(
        Description("Post-processing to be run after media/annotation import")
        .modelParam(
            "id",
            description="Item ID containing the file to process",
            model=Item,
            level=AccessType.WRITE,
        )
        .param(
            "skipJobs",
            "Whether to skip processing that might dispatch worker jobs",
            paramType="formData",
            dataType="boolean",
            default=False,
            required=False,
        )
        .param(
            "skipTranscoding",
            "Whether to skip processing that might dispatch worker jobs",
            paramType="formData",
            dataType="boolean",
            default=True,
            required=False,
        )
    )
    def convert_dive(self, item, skipJobs, skipTranscoding):
        # Get the parent folder and create a new subFolder then move the item into that folder.
        parentFolder = Folder().findOne({"_id": item["folderId"]})
        user = self.getCurrentUser()
        if parentFolder:
            foldername = f'Video {item["name"]}'
            destFolder = Folder().createFolder(
                parentFolder, foldername, creator=user, reuseExisting=True
            )
            Item().move(item, destFolder)
            if not asbool(fromMeta(destFolder, DatasetMarker)):
                destFolder["meta"].update(
                    {
                        TypeMarker: 'video',
                        FPSMarker: -1,  # auto calculate the FPS from import
                    }
                )
                Folder().save(destFolder)
                crud_rpc.postprocess(self.getCurrentUser(), destFolder, skipJobs, skipTranscoding)
            return str(destFolder['_id'])
        return ''

    def get_marked_for_postprocess(self, folder, user, datasets, limit):
        subFolders = list(Folder().childFolders(folder, 'folder', user))
        for child in subFolders:
            if child.get('meta', {}).get(MarkForPostProcess, False):
                if len(datasets) < limit:
                    datasets.append(child)
                else:
                    return
            self.get_marked_for_postprocess(child, user, datasets, limit)

    @access.user
    @autoDescribeRoute(
        Description("Convert folder of images to large images").modelParam(
            "id",
            description="Folder containing the items to process",
            model=Folder,
            level=AccessType.WRITE,
        )
    )
    def convert_large_image(self, folder):
        return crud_rpc.convert_large_image(self.getCurrentUser(), folder)

    @access.user
    @autoDescribeRoute(
        Description("Post-processing for after S3 Imports")
        .modelParam(
            "id",
            description="Folder containing the items to process",
            model=Folder,
            level=AccessType.WRITE,
        )
        .param(
            "skipJobs",
            "Whether to skip processing that might dispatch worker jobs",
            paramType="formData",
            dataType="boolean",
            default=False,
            required=False,
        )
        .param(
            "skipTranscoding",
            "Whether to skip processing that might dispatch worker jobs",
            paramType="formData",
            dataType="boolean",
            default=False,
            required=False,
        )
        .param(
            "limit",
            "Number of Jobs to start to attempt to convert to DIVE format",
            paramType="formData",
            dataType="integer",
            default=100,
            required=False,
        )
    )
    def batch_postprocess(self, folder, skipJobs, skipTranscoding, limit):
        # get a list of possible Datasets
        datasets = []
        self.get_marked_for_postprocess(folder, self.getCurrentUser(), datasets, limit)
        for subFolder in datasets:
            subFolder['meta']['MarkForPostProcess'] = False
            Folder().save(subFolder)
            crud_rpc.postprocess(self.getCurrentUser(), subFolder, skipJobs, skipTranscoding)
