import csv
from datetime import datetime
import io
import re

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.models.item import Item
from girder.models.folder import Folder
from girder.models.upload import Upload
from girder.models.file import File


class ViameDetection(Resource):
    def __init__(self):
        super(ViameDetection, self).__init__()
        self.resourceName = 'viame_detection'
        self.route("GET", (), self.get_detection)
        self.route("PUT", (), self.save_detection)
        self.route("GET", ('clip_meta',), self.get_clip_meta)

    @access.user
    @autoDescribeRoute(
        Description("Run viame pipeline")
        .param("itemId", "Item ID for a video")
        .param("pipeline", "Pipeline to run against the video", default="detector_simple_hough.pipe")
    )
    def get_detection(self, itemId, pipeline):
        item = Item().findOne({
            "meta.itemId": itemId,
            "meta.pipeline": pipeline,
            "meta.old": None
        })
        file = Item().childFiles(item)[0]
        rows = b''.join(list(File().download(file, headers=False)())).decode("utf-8").split('\n')
        reader = csv.reader(row for row in rows if (not row.startswith('#') and row))
        detections = []
        for row in reader:
            confidence_pairs = []
            features = {}
            for i in [i for i in range(9, len(row)) if i % 2 != 0]:
                if row[i].startswith('+'):
                    break
                confidence_pairs.append([row[i], float(row[i+1])])
            for j in range(i, len(row)):
                if 'head' in row[j]:
                    groups = re.match(r'\+kp head ([0-9]+) ([0-9]+)', row[j])
                    if groups:
                        features['head'] = (groups[1], groups[2])
                elif 'tail' in row[j]:
                    groups = re.match(r'\+kp tail ([0-9]+) ([0-9]+)', row[j])
                    if groups:
                        features['tail'] = (groups[1], groups[2])
            detections.append({
                'track': int(row[0]),
                'frame': int(row[2]),
                'bounds': [float(row[3]), float(row[5]), float(row[4]), float(row[6])],
                'confidence': float(row[7]),
                'fishLength': float(row[8]),
                'confidencePairs': confidence_pairs,
                'features': features
            })
        return detections

    @access.user
    @autoDescribeRoute(
        Description("")
        .param("itemId", "Item ID for a video")
        .param("pipeline", "Pipeline to run against the video", default="detector_simple_hough.pipe")
    )
    def get_clip_meta(self, itemId, pipeline):
        detections = list(Item().find({
            "meta.itemId": itemId,
            "meta.pipeline": pipeline,
            "meta.old": None
        }).sort([("created", -1)]))
        detection = None
        if len(detections):
            detection = detections[0]
        video = Item().findOne({
            "meta.itemId": itemId,
            "meta.codec": 'h264'
        })
        return {
            'detection': detection,
            'video': video
        }

    @access.user
    @autoDescribeRoute(
        Description("")
        .param("itemId", "Item ID for a video")
        .param("pipeline", "Pipeline to run against the video", default="detector_simple_hough.pipe")
        .jsonParam('detections', '', requireArray=True, paramType='body')
    )
    def save_detection(self, itemId, pipeline, detections):
        user = self.getCurrentUser()
        existingItem = Item().findOne({
            "meta.itemId": itemId,
            "meta.pipeline": pipeline,
            "meta.old": None
        })
        if existingItem:
            timestamp = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
            existingItem['meta'].update({"old": timestamp})
            Item().setMetadata(existingItem, existingItem['meta'])

        def getRow(d):
            columns = [d['track'], '', d['frame'], d['bounds'][0], d['bounds'][2],
                       d['bounds'][1], d['bounds'][3], d['confidence'], d['fishLength']]
            for [key, confidence] in d['confidencePairs']:
                columns += [key, confidence]
            for [key, values] in d['features'].items():
                columns.append('+kp {} {} {}'.format(key, values[0], values[1]))
            return columns

        csvFile = io.StringIO()
        writer = csv.writer(csvFile)
        for detection in detections:
            writer.writerow(getRow(detection))

        public = Folder().findOne({'parentId': user['_id'], 'name': 'Public'})
        results = Folder().createFolder(public, 'Results', reuseExisting=True)
        newResultItem = Item().createItem(itemId+pipeline, user, results)
        Item().setMetadata(newResultItem, {
            "itemId": itemId,
            "pipeline": pipeline,
        })
        theBytes = csvFile.getvalue().encode()
        byteIO = io.BytesIO(theBytes)
        Upload().uploadFromFile(byteIO, len(theBytes), 'csv', parentType='item',
                                parent=newResultItem, user=user)

        return True
