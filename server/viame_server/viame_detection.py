import csv
import io
import re
from datetime import datetime

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload

from viame_server.serializers import viame
from viame_server.utils import (
    move_existing_result_to_auxiliary_folder,
    validVideoFormats,
    webValidVideoFormats,
)


class ViameDetection(Resource):
    def __init__(self):
        super(ViameDetection, self).__init__()
        self.resourceName = "viame_detection"
        self.route("GET", (), self.get_detection)
        self.route("PUT", (), self.save_detection)
        self.route("GET", ("clip_meta",), self.get_clip_meta)

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
                {"meta.detection": str(folder["_id"])},
                user=self.getCurrentUser(),
            )
        )
        detectionItems.sort(key=lambda d: d["created"], reverse=True)
        if not len(detectionItems):
            return None
        file = Item().childFiles(detectionItems[0])[0]
        return viame.parse(file)

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
        detections = list(
            Item()
            .find({"meta.detection": str(folder["_id"])})
            .sort([("created", -1)])
        )
        detection = detections[0] if len(detections) else None

        # TODO: Instead of doing this lengthy operation, we should
        # set <videoItem>["meta"]["video"] = folder["_id"] on upload,
        # so it can be easily queried with Item().find({"video": folder["_id"]})

        video = None
        items = Item().find({"folderId": folder["_id"]})
        for item in items:
            files = Item().childFiles(item)
            for file in files:
                commonFormats = list(set(file["exts"]) & webValidVideoFormats)
                if commonFormats:
                    video = item
                    break

            if video:
                break

        return {"detection": detection, "video": video}

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
                    columns.append(
                        "(kp) {} {} {}".format(key, values[0], values[1])
                    )
            if d["attributes"]:
                for [key, value] in d["attributes"].items():
                    columns.append(
                        "(atr) {} {}".format(key, valueToString(value))
                    )
            if trackAttributes:
                for [key, value] in trackAttributes.items():
                    columns.append(
                        "(trk-atr) {} {}".format(key, valueToString(value))
                    )
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
        newResultItem = Item().createItem(
            "result_" + timestamp + ".csv", user, folder
        )
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
