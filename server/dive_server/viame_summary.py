import csv
import io
from typing import Callable, Generator, List

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource, setContentDisposition
from girder.constants import AccessType, SortDir, TokenScope
from girder.models.folder import Folder
from girder.models.token import Token

from dive_server.utils import PydanticModel, detections_file, getTrackData
from dive_tasks.summary import generate_max_n_summary, generate_summary
from dive_utils import fromMeta, models
from dive_utils.serializers.viame import format_timestamp
from dive_utils.types import GirderModel


def generate_max_n_summary_csv(
    folders: List[GirderModel],
) -> Callable[[], Generator[str, None, None]]:
    csvFile = io.StringIO()
    writer = csv.writer(csvFile)
    writer.writerow(
        [
            (
                '# Max N Counts summary indicates the single frame with'
                ' the maximum number of detections of a particular type'
                ' for each type within each dataset'
            )
        ]
    )
    writer.writerow(
        [
            '# video or sequence name',
            'dataset_id',
            'annotation_fps',
            'time_id',
            'frame_id',
            'detection_type',
            'detection_count',
        ]
    )

    def gen():
        for folder in folders:
            track_data = getTrackData(detections_file(folder))
            annotation_fps = fromMeta(folder, 'fps')
            for detection_type, result in generate_max_n_summary(track_data).items():
                writer.writerow(
                    [
                        folder['name'],
                        folder['_id'],
                        annotation_fps,
                        format_timestamp(annotation_fps, result['frame']),
                        result['frame'],
                        detection_type,
                        result['count'],
                    ]
                )
                yield csvFile.getvalue()
                csvFile.seek(0)
                csvFile.truncate(0)

    return gen


class SummaryItem(PydanticModel):
    def initialize(self):
        return super().initialize("summaryItem", models.SummaryItemSchema)


class ViameSummary(Resource):
    def __init__(self):
        super(ViameSummary, self).__init__()
        self.resourceName = "viame_summary"

        self.route("GET", (), self.get_summary)
        self.route("POST", (), self.save_summary)
        self.route("GET", ('max_n',), self.max_n)
        self.route("POST", ("generate",), self.regenerate_summary)

    @access.admin
    @autoDescribeRoute(Description('Generate summary of published data'))
    def regenerate_summary(self, params):
        user = self.getCurrentUser()
        token = Token().createToken(user=user, days=14)
        generate_summary.apply_async(
            kwargs=dict(
                girder_client_token=str(token["_id"]),
                girder_job_title='Generate Summary of pubished data',
            ),
        )

    @access.admin
    @autoDescribeRoute(
        Description("Post summary response").jsonParam(
            "summary", "The JSON Body summary", paramType="body", requireObject=True
        )
    )
    def save_summary(self, params, summary):
        validate_summary = models.PublicDataSummary(**summary)
        SummaryItem().collection.remove({})  # drop existing summary
        for item in validate_summary.label_summary_items:
            SummaryItem().create(item)

    @access.user
    @autoDescribeRoute(
        Description("Summarize published datasets").pagingParams(
            "total_tracks", defaultSortDir=SortDir.DESCENDING
        )
    )
    def get_summary(self, params):
        limit, offset, sort = self.getPagingParameters(params)
        return SummaryItem().findWithPermissions(
            offset=offset, limit=limit, sort=sort, user=self.getCurrentUser()
        )

    @access.public(scope=TokenScope.DATA_READ, cookie=True)
    @autoDescribeRoute(
        Description("Export summary of multiple datasets").jsonParam(
            'folder_ids', 'dataset IDs', paramType='query', requireArray=True
        )
    )
    def max_n(self, folder_ids: List[str]):
        setContentDisposition("max_n_summary.csv")
        return generate_max_n_summary_csv(
            [
                Folder().load(id, level=AccessType.READ, user=self.getCurrentUser())
                for id in folder_ids
            ]
        )
