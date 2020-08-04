from girder.api import access
from girder.api.describe import Description, autoDescribeRoute, describeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.folder import Folder
from girder.models.item import Item

from viame_tasks.tasks import convert_images, convert_video, run_pipeline

from .model.attribute import Attribute
from .serializers import meva as meva_serializer
from .serializers import viame as viame_serializer
from .transforms import GetPathFromFolderId, GetPathFromItemId, GirderUploadToFolder
from .utils import (
    csvRegex,
    get_or_create_auxiliary_folder,
    imageRegex,
    move_existing_result_to_auxiliary_folder,
    safeImageRegex,
    saveTracks,
    videoRegex,
    ymlRegex,
)


class Viame(Resource):
    def __init__(self, pipelines=[]):
        super(Viame, self).__init__()
        self.resourceName = "viame"
        self.pipelines = pipelines
        self.route("GET", ("pipelines",), self.get_pipelines)
        self.route("POST", ("pipeline",), self.run_pipeline_task)
        self.route("POST", ("postprocess", ":id"), self.postprocess)
        self.route("POST", ("attribute",), self.create_attribute)
        self.route("GET", ("attribute",), self.get_attributes)
        self.route("PUT", ("attribute", ":id"), self.update_attribute)
        self.route("POST", ("validate_files",), self.validate_files)
        self.route("DELETE", ("attribute", ":id"), self.delete_attribute)
        self.route("GET", ("valid_images",), self.get_valid_images)

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
            girder_job_title=("Running {} on {}".format(pipeline, str(folder["name"]))),
            girder_result_hooks=[
                GirderUploadToFolder(
                    str(folder["_id"]), result_metadata, delete_file=True
                )
            ],
        )

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
        Description(
            "Post-processing to be run after media/annotation import"
        ).modelParam(
            "id",
            description="Folder containing the images to convert",
            model=Folder,
            level=AccessType.WRITE,
        )
    )
    def postprocess(self, folder):
        upload_token = self.getCurrentToken()
        user = self.getCurrentUser()
        auxiliary = get_or_create_auxiliary_folder(folder, user)

        # transcode VIDEO if necessary
        videoItems = Folder().childItems(
            folder, filters={"lowerName": {"$regex": videoRegex}}
        )

        for item in videoItems:
            convert_video.delay(
                GetPathFromItemId(str(item["_id"])),
                str(item["folderId"]),
                str(upload_token["_id"]),
                auxiliary["_id"],
                girder_job_title=(
                    "Converting {} to a web friendly format".format(str(item["_id"]))
                ),
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
                folder["_id"],
                girder_client_token=str(upload_token["_id"]),
                girder_job_title=f"Converting {folder['_id']} to a web friendly format",
            )
        elif imageItems.count() > 0:
            folder["meta"]["annotate"] = True

        # Preprocess CSV if necessasry
        csvItems = Folder().childItems(
            folder, filters={"lowerName": {"$regex": csvRegex}}
        )
        if csvItems.count() == 1:
            file = Item().childFiles(csvItems.next())[0]
            saveTracks(folder, viame_serializer.load_csv_as_tracks(file), user)
        elif csvItems.count() > 1:
            raise RestException('Can have at most 1 annotation CSV file')

        ymlItems = Folder().childItems(
            folder, filters={"lowerName": {"$regex": ymlRegex}}
        )

        # Preprocess KPF if necessary
        if ymlItems.count() > 0:
            # There might be up to 3 yamls
            allFiles = [Item().childFiles(item)[0] for item in ymlItems]
            saveTracks(folder, meva_serializer.load_kpf_as_tracks(allFiles), user)

        Folder().save(folder)
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
            folder, filters={"lowerName": {"$regex": safeImageRegex}}
        )
