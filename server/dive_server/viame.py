import pymongo
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute, describeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.token import Token
from girder.models.user import User
from girder_jobs.models.job import Job

from dive_tasks.tasks import convert_images, convert_video, run_pipeline, train_pipeline
from dive_utils.types import PipelineDescription, PipelineJob

from .constants import csvRegex, imageRegex, safeImageRegex, videoRegex, ymlRegex
from .model.attribute import Attribute
from .pipelines import load_pipelines, load_static_pipelines
from .serializers import meva as meva_serializer
from .training import (
    csv_detection_file,
    load_training_configurations,
    training_output_folder,
)
from .transforms import GetPathFromItemId
from .utils import (
    get_or_create_auxiliary_folder,
    getTrackData,
    move_existing_result_to_auxiliary_folder,
    saveTracks,
)

JOBCONST_DATASET_ID = 'datset_id'
JOBCONST_TRAINING_INPUT_IDS = 'training_input_ids'
JOBCONST_TRAINING_CONFIG = 'training_config'
JOBCONST_RESULTS_FOLDER_ID = 'results_folder_id'
JOBCONST_PIPELINE_NAME = 'pipeline_name'


class Viame(Resource):
    def __init__(self):
        super(Viame, self).__init__()
        self.resourceName = "viame"
        self.static_pipelines = None

        self.route("GET", ("brand_data",), self.get_brand_data)
        self.route("GET", ("pipelines",), self.get_pipelines)
        self.route("POST", ("pipeline",), self.run_pipeline_task)
        self.route("GET", ("training_configs",), self.get_training_configs)
        self.route("POST", ("train",), self.run_training)
        self.route("POST", ("postprocess", ":id"), self.postprocess)
        self.route("POST", ("attribute",), self.create_attribute)
        self.route("GET", ("attribute",), self.get_attributes)
        self.route("PUT", ("attribute", ":id"), self.update_attribute)
        self.route("POST", ("validate_files",), self.validate_files)
        self.route("DELETE", ("attribute", ":id"), self.delete_attribute)
        self.route("GET", ("valid_images",), self.get_valid_images)

    @access.public
    @autoDescribeRoute(Description("Get custom brand data"))
    def get_brand_data(self):
        adminUserIds = [user['_id'] for user in User().getAdmins()]
        # Find an item owned by an admin with meta.brand=True
        data = Item().findOne(
            {
                'meta.brand': {'$in': [True, 'true', 'True']},
                'creatorId': {'$in': adminUserIds},
            }
        )
        if data is not None:
            return data['meta']
        return {}

    @access.user
    @describeRoute(Description("Get available pipelines"))
    def get_pipelines(self, params):
        if self.static_pipelines is None:
            self.static_pipelines = load_static_pipelines()
        return load_pipelines(self.static_pipelines, self.getCurrentUser())

    @access.user
    @describeRoute(Description("Get available training configurations."))
    def get_training_configs(self, params):
        return load_training_configurations()

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
        """
        Run a pipeline on a dataset.

        :param folder: The girder folder containing the dataset to run on.
        :param pipeline: The pipeline to run the dataset on.
        """
        folder_id_str = str(folder["_id"])
        # First, verify that no other outstanding jobs are running on this dataset
        existing_jobs = Job().findOne(
            {
                JOBCONST_DATASET_ID: folder_id_str,
                'status': {
                    # Find jobs that are inactive, queued, or running
                    # https://github.com/girder/girder/blob/main/plugins/jobs/girder_jobs/constants.py
                    '$in': [0, 1, 2]
                },
            }
        )
        if existing_jobs is not None:
            raise RestException(
                (
                    f"A pipeline for {folder_id_str} is already running. "
                    "Only one outstanding job may be run at a time for "
                    "a dataset."
                )
            )

        user = self.getCurrentUser()
        token = Token().createToken(user=user, days=14)
        move_existing_result_to_auxiliary_folder(folder, user)

        params: PipelineJob = {
            "input_folder": folder_id_str,
            "input_type": folder["meta"]["type"],
            "output_folder": folder_id_str,
            "pipeline": pipeline,
        }

        newjob = run_pipeline.apply_async(
            queue="pipelines",
            kwargs=dict(
                params=params,
                girder_job_title=f"Running {pipeline['name']} on {str(folder['name'])}",
                girder_client_token=str(token["_id"]),
                girder_job_type="pipelines",
            ),
        )
        newjob.job[JOBCONST_DATASET_ID] = folder_id_str
        newjob.job[JOBCONST_RESULTS_FOLDER_ID] = folder_id_str
        newjob.job[JOBCONST_PIPELINE_NAME] = pipeline['name']
        # Allow any users with accecss to the input data to also
        # see and possibly manage the job
        Job().copyAccessPolicies(folder, newjob.job)
        Job().save(newjob.job)
        return newjob.job

    @access.user
    @autoDescribeRoute(
        Description("Run training on a folder")
        .jsonParam(
            "folderIds",
            description="Array of folderIds to run training on",
            paramType="body",
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
    )
    def run_training(self, folderIds, pipelineName, config):
        user = self.getCurrentUser()
        token = Token().createToken(user=user, days=14)

        detection_list = []
        folder_list = []
        folder_names = []
        if folderIds is None or len(folderIds) == 0:
            raise RestException("No folderIds in param")

        for folderId in folderIds:
            folder = Folder().load(folderId, level=AccessType.READ, user=user)
            if folder is None:
                raise RestException(f"Cannot access folder {folderId}")
            folder_names.append(folder['name'])
            detections = list(
                Item().find({"meta.detection": str(folderId)}).sort([("created", -1)])
            )
            detection = detections[0] if detections else None

            if not detection:
                raise RestException(f"No detections for folder {folder['name']}")

            # Ensure detection has a csv format
            csv_detection_file(folder, detection, user)
            detection_list.append(detection)
            folder_list.append(folder)

        # Ensure the folder to upload results to exists
        results_folder = training_output_folder(user)

        newjob = train_pipeline.apply_async(
            queue="training",
            kwargs=dict(
                results_folder=results_folder,
                source_folder_list=folder_list,
                groundtruth_list=detection_list,
                pipeline_name=pipelineName,
                config=config,
                girder_client_token=str(token["_id"]),
                girder_job_title=(
                    f"Running training on folder: {', '.join(folder_names)}"
                ),
                girder_job_type="training",
            ),
        )
        newjob.job[JOBCONST_TRAINING_INPUT_IDS] = folderIds
        newjob.job[JOBCONST_RESULTS_FOLDER_ID] = str(results_folder['_id'])
        newjob.job[JOBCONST_TRAINING_CONFIG] = config
        newjob.job[JOBCONST_PIPELINE_NAME] = pipelineName
        Job().save(newjob.job)
        return newjob.job

    @access.user
    @autoDescribeRoute(
        Description("Test whether or not a set of files are safe to upload").jsonParam(
            "files", "", paramType="body"
        )
    )
    def validate_files(self, files):
        ok = True
        message = ""
        mediatype = ""
        videos = [f for f in files if videoRegex.search(f)]
        csvs = [f for f in files if csvRegex.search(f)]
        images = [f for f in files if imageRegex.search(f)]
        ymls = [f for f in files if ymlRegex.search(f)]
        if len(videos) and len(images):
            ok = False
            message = "Do not upload images and videos in the same batch."
        elif len(csvs) > 1:
            ok = False
            message = "Can only upload a single CSV Annotation per import"
        elif len(csvs) == 1 and len(ymls):
            ok = False
            message = "Cannot mix annotation import types"
        elif len(videos) > 1 and (len(csvs) or len(ymls)):
            ok = False
            message = (
                "Annotation upload is not supported when multiple videos are uploaded"
            )
        elif (not len(videos)) and (not len(images)):
            ok = False
            message = "No supported media-type files found"
        elif len(videos):
            mediatype = 'video'
        elif len(images):
            mediatype = 'image-sequence'

        return {
            "ok": ok,
            "message": message,
            "type": mediatype,
            "media": images + videos,
            "annotations": csvs + ymls,
        }

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
    )
    def postprocess(self, folder, skipJobs):
        """
        Post-processing to be run after media/annotation import


        When skipJobs=False, the following may run as jobs:
            Transcoding of Video
            Transcoding of Images
            Conversion of KPF annotations into track JSON

        In either case, the following may run synchronously:
            Conversion of CSV annotations into track JSON
        """
        user = self.getCurrentUser()
        auxiliary = get_or_create_auxiliary_folder(folder, user)

        if not skipJobs:
            token = Token().createToken(user=user, days=2)
            # transcode VIDEO if necessary
            videoItems = Folder().childItems(
                folder, filters={"lowerName": {"$regex": videoRegex}}
            )

            for item in videoItems:
                convert_video.delay(
                    path=GetPathFromItemId(str(item["_id"])),
                    folderId=str(item["folderId"]),
                    auxiliaryFolderId=auxiliary["_id"],
                    itemId=str(item["_id"]),
                    girder_job_title=(
                        "Converting {} to a web friendly format".format(
                            str(item["_id"])
                        )
                    ),
                    girder_client_token=str(token["_id"]),
                )

            # transcode IMAGERY if necessary
            imageItems = Folder().childItems(
                folder, filters={"lowerName": {"$regex": imageRegex}}
            )
            safeImageItems = Folder().childItems(
                folder, filters={"lowerName": {"$regex": safeImageRegex}}
            )

            if imageItems.count() > safeImageItems.count():
                convert_images.delay(
                    folderId=folder["_id"],
                    girder_client_token=str(token["_id"]),
                    girder_job_title=(
                        f"Converting {folder['_id']} to a web friendly format",
                    ),
                )

            elif imageItems.count() > 0:
                folder["meta"]["annotate"] = True

            # transform KPF if necessary
            ymlItems = Folder().childItems(
                folder, filters={"lowerName": {"$regex": ymlRegex}}
            )
            if ymlItems.count() > 0:
                # There might be up to 3 yamls
                allFiles = [Item().childFiles(item)[0] for item in ymlItems]
                saveTracks(folder, meva_serializer.load_kpf_as_tracks(allFiles), user)
                ymlItems.rewind()
                for item in ymlItems:
                    Item().move(item, auxiliary)

            Folder().save(folder)

        # transform CSV if necessasry
        csvItems = Folder().childItems(
            folder,
            filters={"lowerName": {"$regex": csvRegex}},
            sort=[("created", pymongo.DESCENDING)],
        )
        if csvItems.count() >= 1:
            file = Item().childFiles(csvItems.next())[0]
            json_output = getTrackData(file)
            saveTracks(folder, json_output, user)
            csvItems.rewind()
            for item in csvItems:
                Item().move(item, auxiliary)

        return folder

    @access.user
    @autoDescribeRoute(
        Description("").jsonParam("data", "", requireObject=True, paramType="body")
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
    @autoDescribeRoute(Description("").modelParam("id", model=Attribute, required=True))
    def delete_attribute(self, attribute, params):
        return Attribute().remove(attribute)

    @access.user
    @autoDescribeRoute(
        Description("").modelParam(
            "folderId",
            description="folder id of a clip",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
    )
    def get_valid_images(self, folder):
        return Folder().childItems(
            folder,
            filters={"lowerName": {"$regex": safeImageRegex}},
            sort=[("lowerName", pymongo.ASCENDING)],
        )
