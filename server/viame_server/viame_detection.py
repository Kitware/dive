import csv

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.models.item import Item
from girder.models.file import File


class ViameDetection(Resource):
    def __init__(self):
        super(ViameDetection, self).__init__()
        self.resourceName = 'viame_detection'
        self.route("GET", (), self.get_detection_result)

    @access.user
    @autoDescribeRoute(
        Description("Run viame pipeline")
        .param("itemId", "Item ID for a video")
        .param("pipeline", "Pipeline to run against the video", default="detector_simple_hough.pipe")
    )
    def get_detection_result(self, itemId, pipeline):
        item = Item().findOne({
            "meta.itemId": itemId,
            "meta.pipeline": pipeline
        })
        file = Item().childFiles(item)[0]
        rows = b''.join(list(File().download(file, headers=False)())).decode("utf-8").split('\n')
        reader = csv.reader(row for row in rows if (not row.startswith('#') and row))
        # File().download(file)
        detections = []
        for row in reader:
            detections.append({
                'id': row[0],
                'frame': int(row[2]),
                'bounds': [float(row[3]), float(row[5]), float(row[4]), float(row[6])]
            })
        return detections
