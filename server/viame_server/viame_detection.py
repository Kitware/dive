import csv
from datetime import datetime
import io
import re

from girder.api import access
from girder.constants import AccessType
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.models.item import Item
from girder.models.folder import Folder
from girder.models.upload import Upload
from girder.models.file import File

from .utils import move_existing_result_to_auxiliary_folder, validVideoFormats, webValidVideoFormats


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
                {"meta.detection": str(folder["_id"])}, user=self.getCurrentUser(),
            )
        )
        detectionItems.sort(key=lambda d: d["created"], reverse=True)
        if not len(detectionItems):
            return None
        file = Item().childFiles(detectionItems[0])[0]
        rows = (
            b"".join(list(File().download(file, headers=False)()))
            .decode("utf-8")
            .split("\n")
        )
        reader = csv.reader(row for row in rows if (not row.startswith("#") and row))
        detections = []
        for row in reader:
            features = {}
            attributes = {}
            track_attributes = {}

            confidence_pairs = [
                [row[i], float(row[i + 1])]
                for i in range(9, len(row), 2)
                if not row[i].startswith("(")
            ]
            start = len(row) - 1 if len(row) % 2 == 0 else len(row) - 2

            for j in range(start, len(row)):
                if row[j].startswith("(kp)"):
                    if "head" in row[j]:
                        groups = re.match(r"\(kp\) head ([0-9]+) ([0-9]+)", row[j])
                        if groups:
                            features["head"] = (groups[1], groups[2])
                    elif "tail" in row[j]:
                        groups = re.match(r"\(kp\) tail ([0-9]+) ([0-9]+)", row[j])
                        if groups:
                            features["tail"] = (groups[1], groups[2])
                if row[j].startswith("(atr)"):
                    groups = re.match(r"\(atr\) (.+) (.+)", row[j])
                    attributes[groups[1]] = deduceType(groups[2])
                if row[j].startswith("(trk-atr)"):
                    groups = re.match(r"\(trk-atr\) (.+) (.+)", row[j])
                    track_attributes[groups[1]] = deduceType(groups[2])
            detections.append(
                {
                    "track": int(row[0]),
                    "frame": int(row[2]),
                    "bounds": [
                        float(row[3]),
                        float(row[5]),
                        float(row[4]),
                        float(row[6]),
                    ],
                    "confidence": float(row[7]),
                    "fishLength": float(row[8]),
                    "confidencePairs": confidence_pairs,
                    "features": features,
                    "attributes": attributes if attributes else None,
                    "trackAttributes": track_attributes if track_attributes else None,
                }
            )
        return detections

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
            Item().find({"meta.detection": str(folder["_id"])}).sort([("created", -1)])
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


def deduceType(value):
    if value == "true":
        return True
    if value == "false":
        return False
    try:
        number = float(value)
        return number
    except ValueError:
        return value
