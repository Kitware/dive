import json
import urllib
from typing import Dict, List

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource, setContentDisposition, setResponseHeader
from girder.constants import AccessType, TokenScope
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.utility import ziputil

from viame_server.constants import (
    ImageMimeTypes,
    ImageSequenceType,
    VideoMimeTypes,
    VideoType,
    safeImageRegex,
)
from viame_server.serializers import models, viame
from viame_server.utils import getTrackData, saveTracks


class ViameDetection(Resource):
    def __init__(self):
        super(ViameDetection, self).__init__()
        self.resourceName = "viame_detection"
        self.route("GET", (), self.get_detection)
        self.route("PUT", (), self.save_detection)
        self.route("GET", ("clip_meta",), self.get_clip_meta)
        self.route("GET", (":id", "export"), self.get_export_urls)
        self.route("GET", (":id", "export_detections"), self.export_detections)
        self.route("GET", (":id", "export_all"), self.export_all)

    def _get_clip_meta(self, folder):
        detections = list(
            Item().find({"meta.detection": str(folder["_id"])}).sort([("created", -1)])
        )
        detection = detections[0] if len(detections) else None

        videoUrl = None
        video = None
        # Find a video tagged with an h264 codec left by the transcoder
        item = Item().findOne(
            {
                'folderId': folder['_id'],
                'meta.codec': 'h264',
            }
        )
        if item:
            video = Item().childFiles(item)[0]
            videoUrl = (
                f'/api/v1/file/{str(video["_id"])}/download?contentDisposition=inline'
            )

        return {
            'folder': folder,
            'detection': detection,
            'video': video,
            'videoUrl': videoUrl,
        }

    def _load_detections(self, folder):
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

        return file

    def _generate_detections(self, folder, excludeBelowThreshold):
        detectionItems = list(
            Item().findWithPermissions(
                {"meta.detection": str(folder["_id"])}, user=self.getCurrentUser()
            )
        )
        detectionItems.sort(key=lambda d: d["created"], reverse=True)
        item = detectionItems[0]
        file = Item().childFiles(item)[0]

        # TODO: deprecated, remove after we migrate everyone to json
        if "csv" in file["exts"]:
            return File().download(file)

        filename = ".".join([file["name"].split(".")[:-1][0], "csv"])

        foldermeta = folder.get('meta', {})
        fps = None
        imageFiles = None
        source_type = foldermeta.get('type', None)
        if source_type == VideoType:
            fps = foldermeta.get('fps', None)
        elif source_type == ImageSequenceType:
            imageFiles = [
                f['name']
                for f in Folder()
                .childItems(folder, filters={"lowerName": {"$regex": safeImageRegex}})
                .sort("lowerName")
            ]
        thresholds = folder.get("meta", {}).get("confidenceFilters", {})
        track_dict = getTrackData(file)

        def downloadGenerator():
            for data in viame.export_tracks_as_csv(
                track_dict,
                excludeBelowThreshold,
                thresholds=thresholds,
                filenames=imageFiles,
                fps=fps,
            ):
                yield data

        return filename, downloadGenerator

    @access.user
    @autoDescribeRoute(
        Description("Export VIAME data")
        .modelParam(
            "id",
            description="folder id of a clip",
            model=Folder,
            required=True,
            level=AccessType.READ,
        )
        .param(
            "excludeBelowThreshold",
            "Exclude tracks with confidencePairs below set threshold",
            paramType="query",
            dataType="boolean",
            default=False,
        )
    )
    def get_export_urls(self, folder, excludeBelowThreshold):
        folderId = str(folder['_id'])

        export_all = f'/api/v1/folder/{folderId}/download'
        export_media = None
        export_detections = None

        clipMeta = self._get_clip_meta(folder)
        detection = clipMeta.get('detection')
        if detection:
            export_detections = (
                f'/api/v1/viame_detection/{folderId}/export_detections'
                f'?excludeBelowThreshold={excludeBelowThreshold}'
            )
            export_all = (
                f'/api/v1/viame_detection/{folderId}/export_all'
                f'?excludeBelowThreshold={excludeBelowThreshold}'
            )

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
            export_media = (
                f'/api/v1/folder/{folderId}/download?{urllib.parse.urlencode(params)}'
            )

        return {
            'mediaType': source_type,
            'exportAllUrl': export_all,
            'exportMediaUrl': export_media,
            'exportDetectionsUrl': export_detections,
            'currentThresholds': folder.get("meta", {}).get("confidenceFilters", {}),
        }

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @autoDescribeRoute(
        Description("Export detections of a clip into CSV format.")
        .modelParam(
            "id",
            description="folder id of a clip",
            model=Folder,
            required=True,
            level=AccessType.READ,
        )
        .param(
            "excludeBelowThreshold",
            "Exclude tracks with confidencePairs below set threshold",
            paramType="query",
            dataType="boolean",
            default=False,
        )
    )
    def export_detections(self, folder, excludeBelowThreshold):
        filename, gen = self._generate_detections(folder, excludeBelowThreshold)
        setContentDisposition(filename)
        return gen

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @autoDescribeRoute(
        Description("Export detections of a clip into CSV format.")
        .modelParam(
            "id",
            description="folder id of a clip",
            model=Folder,
            required=True,
            level=AccessType.READ,
        )
        .param(
            "excludeBelowThreshold",
            "Exclude tracks with confidencePairs below set threshold",
            paramType="query",
            dataType="boolean",
            default=False,
        )
    )
    def export_all(self, folder, excludeBelowThreshold):
        _, gen = self._generate_detections(folder, excludeBelowThreshold)
        setResponseHeader('Content-Type', 'application/zip')
        setContentDisposition(folder['name'] + '.zip')
        user = self.getCurrentUser()

        def stream():
            z = ziputil.ZipGenerator(folder['name'])
            for (path, file) in Folder().fileList(folder, user=user, subpath=False):
                for data in z.addFile(file, path):
                    yield data
            for data in z.addFile(gen, "output_tracks.csv"):
                yield data
            yield z.footer()

        return stream

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
        file = self._load_detections(folder)
        if file is None:
            return {}
        if "csv" in file["exts"]:
            return getTrackData(file)
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
            level=AccessType.WRITE,
        )
        .jsonParam(
            "tracks", "upsert and delete tracks", paramType="body", requireObject=True
        )
    )
    def save_detection(self, folder, tracks):
        user = self.getCurrentUser()
        upsert: Dict[str, dict] = tracks.get('upsert', {})
        delete: List[str] = tracks.get('delete', [])
        track_dict = getTrackData(self._load_detections(folder))

        for track_id in delete:
            track_dict.pop(str(track_id), None)
        for track_id, track in upsert.items():
            validated: models.Track = models.Track(**track)
            track_dict[str(track_id)] = validated.dict(exclude_none=True)

        upserted_len = len(upsert.keys())
        deleted_len = len(delete)

        if upserted_len or deleted_len:
            saveTracks(folder, track_dict, user)

        return {
            "updated": upserted_len,
            "deleted": deleted_len,
        }
