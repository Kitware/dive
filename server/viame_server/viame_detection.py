import csv
import io
import json
import re
import urllib
from datetime import datetime

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType, TokenScope
from girder.exceptions import RestException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload
from girder.utility import ziputil

from viame_server.serializers import viame
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

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
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
            itemId = detection.get('_id', None)
            export_detections = f'/api/v1/item/{itemId}/download'

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

    @access.user
    @autoDescribeRoute(
        Description("Get detections of a clip")
        .modelParam(
            "folderId",
            description="folder id of a clip",
            model=Folder,
            paramType="query",
            required=True,
            level=AccessType.READ,
        )
        .param("formatting", "Format to fetch", default="",)
    )
    def get_detection(self, folder, formatting):
        detectionItems = list(
            Item().findWithPermissions(
                {"meta.detection": str(folder["_id"])}, user=self.getCurrentUser(),
            )
        )
        detectionItems.sort(key=lambda d: d["created"], reverse=True)
        if not len(detectionItems):
            return None
        file = Item().childFiles(detectionItems[0])[0]
        if formatting == "track_json":
            return viame.parseTracks(file)
        elif formatting == "detection_json":
            return viame.parse(file)
        raise RestException(f"formatting {formatting} is not recognized")

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
        .jsonParam("detections", "", requireArray=True, paramType="body")
    )
    def save_detection(self, folder, detections):
        user = self.getCurrentUser()

        def valueToString(value):
            if value is True:
                return "true"
            elif value is False:
                return "false"
            return str(value)

        def getRow(d, trackAttributes=None):
            columns = [
                d["track"],
                "",
                d["frame"],
                d["bounds"][0],
                d["bounds"][2],
                d["bounds"][1],
                d["bounds"][3],
                d["confidence"],
                d["fishLength"],
            ]
            for [key, confidence] in d["confidencePairs"]:
                columns += [key, confidence]
            if d["features"]:
                for [key, values] in d["features"].items():
                    columns.append("(kp) {} {} {}".format(key, values[0], values[1]))
            if d["attributes"]:
                for [key, value] in d["attributes"].items():
                    columns.append("(atr) {} {}".format(key, valueToString(value)))
            if trackAttributes:
                for [key, value] in trackAttributes.items():
                    columns.append("(trk-atr) {} {}".format(key, valueToString(value)))
            return columns

        detections.sort(key=lambda d: d["track"])

        csvFile = io.StringIO()
        writer = csv.writer(csvFile)
        trackAttributes = None
        length = len(detections)
        track = detections[0]["track"]
        for i in range(0, len(detections)):
            trackAttributes = (
                detections[i]["trackAttributes"]
                if detections[i]["trackAttributes"]
                else None
            )
            if i == length - 1 or detections[i + 1]["track"] != track:
                writer.writerow(getRow(detections[i], trackAttributes))
            else:
                writer.writerow(getRow(detections[i]))

        move_existing_result_to_auxiliary_folder(folder, user)

        timestamp = datetime.now().strftime("%m-%d-%Y_%H:%M:%S")
        newResultItem = Item().createItem("result_" + timestamp + ".csv", user, folder)
        Item().setMetadata(
            newResultItem, {"detection": str(folder["_id"])}, allowNull=True,
        )
        theBytes = csvFile.getvalue().encode()
        byteIO = io.BytesIO(theBytes)
        Upload().uploadFromFile(
            byteIO,
            len(theBytes),
            "result.csv",
            parentType="item",
            parent=newResultItem,
            user=user,
        )
        return True
