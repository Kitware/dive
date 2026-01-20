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
from .sam2_service import get_sam2_service
from .stereo_service import get_stereo_service

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

        # SAM2 Interactive Segmentation
        self.route("POST", ("sam2_predict",), self.sam2_predict)
        self.route("GET", ("sam2_status",), self.sam2_status)

        # Foundation Stereo Interactive Service
        self.route("POST", ("stereo_enable",), self.stereo_enable)
        self.route("POST", ("stereo_disable",), self.stereo_disable)
        self.route("POST", ("stereo_set_frame",), self.stereo_set_frame)
        self.route("POST", ("stereo_transfer_line",), self.stereo_transfer_line)
        self.route("POST", ("stereo_transfer_points",), self.stereo_transfer_points)
        self.route("GET", ("stereo_status",), self.stereo_status)

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
        Description("Run SAM2 point-based segmentation")
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
    def sam2_predict(self, folder, frameNumber, body):
        """
        Run SAM2 prediction with point prompts.

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
            score: Quality score from SAM2
            lowResMask: Low-res mask for subsequent refinement
        """
        from dive_utils import fromMeta
        from dive_utils.constants import TypeMarker, ImageSequenceType, VideoType
        from girder.models.file import File
        from girder.models.item import Item
        import os

        sam2 = get_sam2_service()

        if not sam2.is_available():
            return {
                "success": False,
                "error": "SAM2 is not available. Enable VIAME_ENABLE_PYTORCH-SAM2 in your build.",
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
                # For video, we would need to extract a frame
                # This requires ffmpeg and is more complex
                return {
                    "success": False,
                    "error": "SAM2 for video datasets is not yet supported. Use image sequences.",
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

            # Run SAM2 prediction
            result = sam2.predict(
                image_path=image_path,
                points=body.get("points", []),
                point_labels=body.get("pointLabels", []),
                mask_input=body.get("maskInput"),
                multimask_output=body.get("multimaskOutput", False),
            )
            return result

        except Exception as e:
            logger.exception("SAM2 prediction failed")
            return {
                "success": False,
                "error": str(e),
            }

    @access.user
    @autoDescribeRoute(Description("Get SAM2 service status"))
    def sam2_status(self):
        """Check if SAM2 service is available and loaded."""
        sam2 = get_sam2_service()
        return {
            "available": sam2.is_available(),
            "loaded": sam2.is_loaded(),
        }

    # ============== Foundation Stereo Interactive Endpoints ==============

    @access.user
    @autoDescribeRoute(
        Description("Enable Foundation Stereo interactive service")
        .modelParam(
            "folderId",
            description="Dataset folder ID (for loading calibration)",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
    )
    def stereo_enable(self, folder):
        """
        Enable the Foundation Stereo service for interactive stereo annotation.

        This loads the model and prepares for proactive disparity computation.
        The calibration matrix is loaded from the dataset if available.
        """
        import os
        import json
        from girder.models.item import Item
        from girder.models.file import File

        stereo = get_stereo_service()

        if not stereo.is_available():
            return {
                "success": False,
                "error": "Foundation Stereo is not available. Enable VIAME_ENABLE_PYTORCH-FOUNDATION-STEREO in your build.",
            }

        try:
            # Try to load calibration from the dataset
            calibration = None
            items = list(Item().find({"folderId": folder["_id"]}))
            for item in items:
                if item.get("name", "").lower() in ["calibration.json", "calibration_matrices.json"]:
                    files = list(File().find({"itemId": item["_id"]}))
                    if files:
                        assetstore = File().getAssetstoreAdapter(files[0])
                        cal_path = assetstore.fullPath(files[0])
                        if os.path.exists(cal_path):
                            with open(cal_path, 'r') as f:
                                calibration = json.load(f)
                            logger.info(f"Loaded calibration from {cal_path}")
                            break

            result = stereo.enable(calibration)
            return result

        except Exception as e:
            logger.exception("Failed to enable Foundation Stereo")
            return {
                "success": False,
                "error": str(e),
            }

    @access.user
    @autoDescribeRoute(Description("Disable Foundation Stereo interactive service"))
    def stereo_disable(self):
        """Disable the Foundation Stereo service and free resources."""
        stereo = get_stereo_service()
        return stereo.disable()

    @access.user
    @autoDescribeRoute(
        Description("Set current stereo frame for disparity computation")
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
            description="Frame number to compute disparity for",
            paramType="query",
            dataType="integer",
            required=True,
        )
    )
    def stereo_set_frame(self, folder, frameNumber):
        """
        Set the current frame and start computing disparity proactively.

        This should be called when the user navigates to a new frame in stereo mode.
        The disparity computation starts immediately in the background, so it's
        ready when the user draws annotations.

        For stereo datasets, this expects a folder structure where images are
        organized as left/right pairs (e.g., sorted by name with left images
        in the first half and right in the second half, or by naming convention).
        """
        import os
        from dive_utils import fromMeta
        from dive_utils.constants import TypeMarker, ImageSequenceType
        from girder.models.item import Item
        from girder.models.file import File

        stereo = get_stereo_service()

        if not stereo.is_enabled():
            return {
                "success": False,
                "error": "Stereo service not enabled. Call stereo_enable first.",
            }

        try:
            dataset_type = fromMeta(folder, TypeMarker)
            if dataset_type != ImageSequenceType:
                return {
                    "success": False,
                    "error": f"Stereo mode only supports image sequences, got: {dataset_type}",
                }

            # Get all image items sorted by name
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

            # For stereo, we expect pairs - either by convention or structure
            # Common conventions:
            # 1. First half = left, second half = right
            # 2. Names ending in _L/_R or _left/_right
            # 3. Alternating left/right

            num_images = len(image_items)

            # Try to detect naming convention
            left_images = []
            right_images = []

            for item in image_items:
                name = item.get("name", "").lower()
                if "_l." in name or "_left." in name or "/left/" in name or "left_" in name:
                    left_images.append(item)
                elif "_r." in name or "_right." in name or "/right/" in name or "right_" in name:
                    right_images.append(item)

            # If no naming convention detected, assume first half is left
            if not left_images or not right_images:
                half = num_images // 2
                left_images = image_items[:half]
                right_images = image_items[half:]

            if frameNumber < 0 or frameNumber >= len(left_images):
                return {
                    "success": False,
                    "error": f"Frame {frameNumber} out of range (0-{len(left_images)-1})",
                }

            if frameNumber >= len(right_images):
                return {
                    "success": False,
                    "error": f"No matching right image for frame {frameNumber}",
                }

            # Get file paths
            left_item = left_images[frameNumber]
            right_item = right_images[frameNumber]

            left_files = list(File().find({"itemId": left_item["_id"]}))
            right_files = list(File().find({"itemId": right_item["_id"]}))

            if not left_files or not right_files:
                return {
                    "success": False,
                    "error": "Could not find image files for the stereo pair",
                }

            left_assetstore = File().getAssetstoreAdapter(left_files[0])
            right_assetstore = File().getAssetstoreAdapter(right_files[0])

            left_path = left_assetstore.fullPath(left_files[0])
            right_path = right_assetstore.fullPath(right_files[0])

            if not os.path.exists(left_path):
                return {"success": False, "error": f"Left image not found: {left_path}"}
            if not os.path.exists(right_path):
                return {"success": False, "error": f"Right image not found: {right_path}"}

            result = stereo.set_frame(left_path, right_path)
            result["left_image"] = left_item.get("name")
            result["right_image"] = right_item.get("name")
            return result

        except Exception as e:
            logger.exception("Failed to set stereo frame")
            return {
                "success": False,
                "error": str(e),
            }

    @access.user
    @autoDescribeRoute(
        Description("Transfer a line from left to right image using disparity")
        .jsonParam(
            "body",
            description="JSON object with line points",
            paramType="body",
            schema={
                "line": List[List[float]],  # [[x1, y1], [x2, y2]]
            },
        )
    )
    def stereo_transfer_line(self, body):
        """
        Transfer a line from the left stereo image to the right image.

        Given a line defined by two points on the left image, computes the
        corresponding points on the right image using the disparity map.

        Request body:
            line: List of two [x, y] points defining the line

        Returns:
            transferred_line: The line points on the right image
            original_line: The input line
            depth_info: Optional depth information if calibration is available
        """
        stereo = get_stereo_service()

        try:
            line = body.get("line")
            if not line:
                return {"success": False, "error": "line is required"}

            return stereo.transfer_line(line)

        except Exception as e:
            logger.exception("Failed to transfer line")
            return {
                "success": False,
                "error": str(e),
            }

    @access.user
    @autoDescribeRoute(
        Description("Transfer points from left to right image using disparity")
        .jsonParam(
            "body",
            description="JSON object with points",
            paramType="body",
            schema={
                "points": List[List[float]],  # [[x1, y1], [x2, y2], ...]
            },
        )
    )
    def stereo_transfer_points(self, body):
        """
        Transfer multiple points from the left stereo image to the right image.

        Request body:
            points: List of [x, y] points

        Returns:
            transferred_points: The points on the right image
            original_points: The input points
            disparity_values: Disparity value at each point
        """
        stereo = get_stereo_service()

        try:
            points = body.get("points")
            if not points:
                return {"success": False, "error": "points is required"}

            return stereo.transfer_points(points)

        except Exception as e:
            logger.exception("Failed to transfer points")
            return {
                "success": False,
                "error": str(e),
            }

    @access.user
    @autoDescribeRoute(Description("Get Foundation Stereo service status"))
    def stereo_status(self):
        """
        Get the current status of the Foundation Stereo service.

        Returns:
            enabled: Whether the service is enabled
            disparity_ready: Whether disparity is computed for current frame
            computing: Whether disparity is currently being computed
            has_calibration: Whether calibration data is loaded
            model_loaded: Whether the model is loaded
        """
        stereo = get_stereo_service()
        return {
            "available": stereo.is_available(),
            **stereo.get_status(),
        }
