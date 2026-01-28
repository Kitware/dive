import logging
from typing import List, Optional

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.token import Token

from dive_utils import asbool, fromMeta
from dive_utils.constants import DatasetMarker, FPSMarker, MarkForPostProcess, TypeMarker
from dive_utils.types import PipelineDescription, TrainingModelTuneArgs

from . import crud, crud_rpc
from .viame_segmentation_service import get_viame_segmentation_service

logger = logging.getLogger(__name__)


class RpcResource(Resource):
    """Remote procedure calls to celery and other non-RESTful operations"""

    def __init__(self, resourceName):
        super(RpcResource, self).__init__()
        self.resourceName = resourceName

        self.route("POST", ("pipeline",), self.run_pipeline_task)
        self.route("POST", ("export",), self.export_pipeline_onnx)
        self.route("POST", ("train",), self.run_training)
        self.route("POST", ("postprocess", ":id"), self.postprocess)
        self.route("POST", ("convert_dive", ":id"), self.convert_dive)
        self.route("POST", ("convert_large_image", ":id"), self.convert_large_image)
        self.route("POST", ("batch_postprocess", ":id"), self.batch_postprocess)

        # Interactive Segmentation
        self.route("POST", ("segmentation_predict",), self.segmentation_predict)
        self.route("GET", ("segmentation_status",), self.segmentation_status)

        # Text Query (detection/segmentation via text prompts)
        self.route("POST", ("text_query",), self.text_query)

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
        .param(
            "forceTranscoded",
            "Force using the transcoded instead of source media",
            paramType="query",
            dataType="boolean",
            default=False,
            required=False,
        )
        .jsonParam("pipeline", "The pipeline to run on the dataset", required=True)
    )
    def run_pipeline_task(self, folder, forceTranscoded, pipeline: PipelineDescription):
        return crud_rpc.run_pipeline(self.getCurrentUser(), folder, pipeline, forceTranscoded)

    @access.user
    @autoDescribeRoute(
        Description("Export pipeline to ONNX")
        .modelParam(
            "modelFolderId",
            destName='modelFolderId',
            description="Folder id in which the model to export is located",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
        .modelParam(
            "exportFolderId",
            destName='exportFolderId',
            description="Folder id to which the model will be exported",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.WRITE,
        )
    )
    def export_pipeline_onnx(self, modelFolderId, exportFolderId):
        return crud_rpc.export_trained_pipeline(self.getCurrentUser(), modelFolderId, exportFolderId)

    @access.user
    @autoDescribeRoute(
        Description("Run training on a folder")
        .jsonParam(
            "body",
            description="JSON object with Array of folderIds to run training on\
             and labels.txt file content.  Optionally a model that can be used for fine tune training",
            paramType="body",
            schema={
                "folderIds": List[str],
                "labelText": str,
                "model": Optional[TrainingModelTuneArgs],
            },
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
        .param(
            "forceTranscoded",
            "Force using the transcoded instead of source media",
            paramType="query",
            dataType="boolean",
            default=False,
            required=False,
        )
    )
    def run_training(self, body, pipelineName, config, annotatedFramesOnly, forceTranscoded):
        user = self.getCurrentUser()
        token = Token().createToken(user=user, days=14)
        run_training_args = crud.get_validated_model(crud_rpc.RunTrainingArgs, **body)
        return crud_rpc.run_training(
            user,
            token,
            run_training_args,
            pipelineName,
            config,
            annotatedFramesOnly,
            forceTranscoded,
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

    @access.user
    @autoDescribeRoute(
        Description("Run point-based interactive segmentation")
        .modelParam(
            "folderId",
            description="Dataset folder ID",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
        .param(
            "frameNumber",
            description="Frame number to segment",
            paramType="query",
            dataType="integer",
            required=True,
        )
        .jsonParam(
            "body",
            description="JSON object with point prompts",
            paramType="body",
            schema={
                "points": List[List[float]],
                "pointLabels": List[int],
                "maskInput": Optional[List[List[float]]],
                "multimaskOutput": Optional[bool],
            },
        )
    )
    def segmentation_predict(self, folder, frameNumber, body):
        """
        Run segmentation prediction with point prompts.

        Query params:
            folderId: Dataset folder ID
            frameNumber: Frame number to segment

        Request body:
            points: List of [x, y] point coordinates
            pointLabels: List of labels (1=foreground, 0=background)
            maskInput: Optional low-res mask for refinement
            multimaskOutput: Whether to return multiple masks (default: false)

        Returns:
            polygon: List of [x, y] coordinate pairs
            bounds: [x_min, y_min, x_max, y_max]
            score: Quality score
            lowResMask: Low-res mask for subsequent refinement
        """
        from dive_utils import fromMeta
        from dive_utils.constants import TypeMarker, ImageSequenceType, VideoType
        from girder.models.file import File
        from girder.models.item import Item
        import os

        service = get_viame_segmentation_service()

        if not service.is_available():
            return {
                "success": False,
                "error": "Segmentation is not available. Check your VIAME installation.",
            }

        try:
            # Get dataset type and resolve image path
            dataset_type = fromMeta(folder, TypeMarker)
            image_path = None

            if dataset_type == ImageSequenceType:
                # Find image items in the folder, sorted by name
                items = list(Item().find(
                    {"folderId": folder["_id"]},
                    sort=[("name", 1)]
                ))

                # Filter to only image items
                image_items = [
                    item for item in items
                    if item.get("name", "").lower().endswith(
                        ('.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp')
                    )
                ]

                if frameNumber < 0 or frameNumber >= len(image_items):
                    return {
                        "success": False,
                        "error": f"Frame {frameNumber} out of range (0-{len(image_items)-1})",
                    }

                image_item = image_items[frameNumber]
                files = list(File().find({"itemId": image_item["_id"]}))
                if not files:
                    return {
                        "success": False,
                        "error": f"No file found for frame {frameNumber}",
                    }

                # Get the file path from Girder's assetstore
                file_doc = files[0]
                assetstore = File().getAssetstoreAdapter(file_doc)
                image_path = assetstore.fullPath(file_doc)

            elif dataset_type == VideoType:
                return {
                    "success": False,
                    "error": "Segmentation for video datasets is not yet supported. Use image sequences.",
                }
            else:
                return {
                    "success": False,
                    "error": f"Unsupported dataset type: {dataset_type}",
                }

            if not image_path or not os.path.exists(image_path):
                return {
                    "success": False,
                    "error": f"Image file not found: {image_path}",
                }

            # Run segmentation prediction
            result = service.predict(
                image_path=image_path,
                points=body.get("points", []),
                point_labels=body.get("pointLabels", []),
                mask_input=body.get("maskInput"),
                multimask_output=body.get("multimaskOutput", False),
            )
            return result

        except Exception as e:
            logger.exception("Segmentation prediction failed")
            return {
                "success": False,
                "error": str(e),
            }

    @access.user
    @autoDescribeRoute(Description("Get segmentation service status"))
    def segmentation_status(self):
        """Check if segmentation service is available and loaded."""
        service = get_viame_segmentation_service()
        service_info = service.get_service_info()
        return {
            "available": service.is_available(),
            "loaded": service.is_loaded(),
            "text_query_available": service.is_text_query_available(),
            "device": service_info.get('device'),
        }

    @access.user
    @autoDescribeRoute(
        Description("Run text-based object detection and segmentation")
        .modelParam(
            "folderId",
            description="Dataset folder ID",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
        .param(
            "frameNumber",
            description="Frame number to query",
            paramType="query",
            dataType="integer",
            required=True,
        )
        .jsonParam(
            "body",
            description="JSON object with text query parameters",
            paramType="body",
            schema={
                "text": str,
                "boxThreshold": Optional[float],
                "textThreshold": Optional[float],
                "maxDetections": Optional[int],
            },
        )
    )
    def text_query(self, folder, frameNumber, body):
        """
        Detect objects using text query and segment them.

        Query params:
            folderId: Dataset folder ID
            frameNumber: Frame number to query

        Request body:
            text: Text describing objects to find (e.g., "fish", "coral reef")
            boxThreshold: Detection confidence threshold (default: 0.3)
            textThreshold: Text matching threshold (default: 0.25)
            maxDetections: Maximum detections to return (default: 10)

        Returns:
            detections: List of objects, each with polygon, bounds, score, label
        """
        from dive_utils import fromMeta
        from dive_utils.constants import TypeMarker, ImageSequenceType, VideoType
        from girder.models.file import File
        from girder.models.item import Item
        import os

        service = get_viame_segmentation_service()

        if not service.is_available():
            return {
                "success": False,
                "error": "Segmentation service is not available.",
            }

        if not service.is_text_query_available():
            return {
                "success": False,
                "error": "Text query is not supported by the current segmentation config.",
            }

        try:
            # Get dataset type and resolve image path
            dataset_type = fromMeta(folder, TypeMarker)
            image_path = None

            if dataset_type == ImageSequenceType:
                items = list(Item().find(
                    {"folderId": folder["_id"]},
                    sort=[("name", 1)]
                ))

                image_items = [
                    item for item in items
                    if item.get("name", "").lower().endswith(
                        ('.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp')
                    )
                ]

                if frameNumber < 0 or frameNumber >= len(image_items):
                    return {
                        "success": False,
                        "error": f"Frame {frameNumber} out of range (0-{len(image_items)-1})",
                    }

                image_item = image_items[frameNumber]
                files = list(File().find({"itemId": image_item["_id"]}))
                if not files:
                    return {
                        "success": False,
                        "error": f"No file found for frame {frameNumber}",
                    }

                file_doc = files[0]
                assetstore = File().getAssetstoreAdapter(file_doc)
                image_path = assetstore.fullPath(file_doc)

            elif dataset_type == VideoType:
                return {
                    "success": False,
                    "error": "Text query for video datasets is not yet supported.",
                }
            else:
                return {
                    "success": False,
                    "error": f"Unsupported dataset type: {dataset_type}",
                }

            if not image_path or not os.path.exists(image_path):
                return {
                    "success": False,
                    "error": f"Image file not found: {image_path}",
                }

            # Run text query
            result = service.text_query(
                image_path=image_path,
                text=body.get("text", "object"),
                box_threshold=body.get("boxThreshold", 0.3),
                text_threshold=body.get("textThreshold", 0.25),
                max_detections=body.get("maxDetections", 10),
            )
            return result

        except Exception as e:
            logger.exception("Text query failed")
            return {
                "success": False,
                "error": str(e),
            }
