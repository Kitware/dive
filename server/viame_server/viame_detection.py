import io
import json
import urllib
from datetime import datetime

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType, TokenScope
from girder.exceptions import RestException
from girder.models.assetstore import Assetstore
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload

from viame_server.serializers import viame, meva
from viame_server.utils import (
    ImageMimeTypes,
    ImageSequenceType,
    VideoMimeTypes,
    VideoType,
    move_existing_result_to_auxiliary_folder,
)


class ViameDetection(Resource):
    def __init__(self):
        super(ViameDetection, self).__init__()
        self.resourceName = "viame_detection"
        self.route("GET", (), self.get_detection)
        self.route("PUT", (), self.save_detection)
        self.route("GET", ("clip_meta",), self.get_clip_meta)
        self.route("GET", (":id", "export",), self.export_data)
        self.route("GET", (":id", "export_detections",), self.export_detections)

        self.route("GET", ("meva",), self.get_meva_detection)

    def _get_clip_meta(self, folder):
        detections = list(
            Item().find({"meta.detection": str(folder["_id"])}).sort([("created", -1)])
        )
        detection = detections[0] if len(detections) else None

        videoUrl = None
        # Find a video tagged with an h264 codec left by the transcoder
        video = Item().findOne({'folderId': folder['_id'], 'meta.codec': 'h264',})
        if video:
            videoUrl = (
                f'/api/v1/item/{str(video["_id"])}/download?contentDisposition=inline'
            )

        return {
            'folder': folder,
            'detection': detection,
            'video': video,
            'videoUrl': videoUrl,
        }

    @access.user
    @autoDescribeRoute(
        Description("Export VIAME data").modelParam(
            "id",
            description="folder id of a clip",
            model=Folder,
            required=True,
            level=AccessType.READ,
        )
    )
    def export_data(self, folder):
        folderId = str(folder['_id'])

        export_all = f'/api/v1/folder/{folderId}/download'
        export_media = None
        export_detections = None

        clipMeta = self._get_clip_meta(folder)
        detection = clipMeta.get('detection')
        if detection:
            export_detections = f'/api/v1/viame_detection/{folderId}/export_detections'

        source_type = folder.get('meta', {}).get('type', None)
        if source_type == VideoType:
            params = {
                'mimeFilter': json.dumps(list(VideoMimeTypes)),
            }
            export_media = (
                f'/api/v1/folder/{folderId}/download?{urllib.parse.urlencode(params)}'
            )
        elif source_type == ImageSequenceType:
            params = {
                'mimeFilter': json.dumps(list(ImageMimeTypes)),
            }
            print(params)
            export_media = (
                f'/api/v1/folder/{folderId}/download?{urllib.parse.urlencode(params)}'
            )

        return {
            'mediaType': source_type,
            'exportAllUrl': export_all,
            'exportMediaUrl': export_media,
            'exportDetectionsUrl': export_detections,
        }

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @autoDescribeRoute(
        Description("Export detections of a clip into CSV format.").modelParam(
            "id",
            description="folder id of a clip",
            model=Folder,
            required=True,
            level=AccessType.READ,
        )
    )
    def export_detections(self, folder):
        user = self.getCurrentUser()

        detectionItems = list(
            Item().findWithPermissions(
                {"meta.detection": str(folder["_id"])}, user=self.getCurrentUser(),
            )
        )
        detectionItems.sort(key=lambda d: d["created"], reverse=True)
        item = detectionItems[0]
        file = Item().childFiles(item)[0]

        if "csv" in file["exts"]:
            return File().download(file)

        filename = ".".join([file["name"].split(".")[:-1][0], "csv"])

        csv_string = viame.export_tracks_as_csv(file)
        csv_bytes = csv_string.encode()

        assetstore = Assetstore().findOne({"_id": file["assetstoreId"]})
        new_file = File().findOne({"name": filename}) or File().createFile(
            user, item, filename, len(csv_bytes), assetstore
        )

        upload = Upload().createUploadToFile(new_file, user, len(csv_bytes))
        new_file = Upload().handleChunk(upload, csv_bytes)

        return File().download(new_file)

    @access.user
    @autoDescribeRoute(
        Description("Get detections of a clip").modelParam(
            "folderId",
            description="folder id of a clip",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
    )
    def get_detection(self, folder):
        detectionItems = list(
            Item().findWithPermissions(
                {"meta.detection": str(folder["_id"])}, user=self.getCurrentUser(),
            )
        )
        detectionItems.sort(key=lambda d: d["created"], reverse=True)

        if not len(detectionItems):
            return None

        files = Item().childFiles(detectionItems[0])
        file = files[0]
        if "csv" in file["exts"]:
            return viame.load_csv_as_tracks(file)
        else:
            yamls = []
            for f in files:
                if "yml" in file["exts"]:
                    yamls.append(f)
            if yamls:
                return meva.load_kpf_as_tracks(yamls)

        return File().download(file, contentDisposition="inline")

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
    def get_clip_meta(self, folder):
        return self._get_clip_meta(folder)

    @access.user
    @autoDescribeRoute(
        Description("")
        .modelParam(
            "folderId",
            description="folder id of a clip",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
        .jsonParam("tracks", "", paramType="body")
    )
    def save_detection(self, folder, tracks):
        user = self.getCurrentUser()

        timestamp = datetime.now().strftime("%m-%d-%Y_%H:%M:%S")
        item_name = f"result_{timestamp}.json"

        move_existing_result_to_auxiliary_folder(folder, user)
        newResultItem = Item().createItem(item_name, user, folder)
        Item().setMetadata(
            newResultItem, {"detection": str(folder["_id"])}, allowNull=True,
        )

        json_bytes = json.dumps(tracks).encode()
        byteIO = io.BytesIO(json_bytes)
        Upload().uploadFromFile(
            byteIO,
            len(json_bytes),
            item_name,
            parentType="item",
            parent=newResultItem,
            user=user,
            mimeType="application/json",
        )

        return True

    @access.user
    @autoDescribeRoute(
        Description("Get detections of a meva clip").modelParam(
            "folderId",
            description="folder id of a meva clip",
            model=Folder,
            paramType="query",
            required=False,
            level=AccessType.READ,
        )
    )
    def get_meva_detection(self, folder):
        try:
            detectionItems = list(
                Item().findWithPermissions(
                    {"folderId": folder["_id"]}, user=self.getCurrentUser(),
                )
            )

            detectionItems.sort(key=lambda d: d["created"], reverse=True)
            files = Item().childFiles(detectionItems)
            yamls = []
            for file in files:
                if "yml" in file["exts"]:
                    yamls.append(file)
            return yamls

        except:
            items = Folder().childItems(folder)
            yamls = []
            for item in items:
                files = Item().childFiles(item)
                for file in files:
                    if "yml" in file["exts"]:
                        yamls.append(file)
            # nut.append("nut")
            return meva.load_kpf_as_tracks(yamls)
