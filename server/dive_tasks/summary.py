from typing import Any, Dict

from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager

from dive_utils.constants import PublishedMarker
from dive_utils.models import PublicDataSummary, SummaryItemSchema, Track


def summarize_annotations(
    datasetId: str, trackData: Dict[str, Any], summary: Dict[str, SummaryItemSchema]
):
    for trackdict in trackData.values():
        track = Track(**trackdict)
        for name, _ in track.confidencePairs:
            if name in summary:
                summary[name].found_in = list(set(summary[name].found_in + [datasetId]))
                summary[name].total_tracks += 1
                summary[name].total_detections += len(track.features)
            else:
                summary[name] = SummaryItemSchema(
                    value=name,
                    total_tracks=1,
                    total_detections=len(track.features),
                    found_in=[datasetId],
                )


@app.task(bind=True, acks_late=True)
def generate_summary(self: Task):
    manager: JobManager = self.job_manager
    gc: GirderClient = self.girder_client

    limit = 50
    offset = 0
    total = int(
        gc.get(
            'viame/datasets',
            parameters={'limit': 1, PublishedMarker: True},
            jsonResp=False,
        ).headers['girder-total-count']
    )
    print(limit, offset, total)

    summary: Dict[str, SummaryItemSchema] = {}
    while offset < total:
        page = gc.get(
            'viame/datasets',
            parameters={
                'limit': limit,
                'offset': offset,
                PublishedMarker: True,
            },
        )
        offset += limit
        for dataset in page:
            summarize_annotations(
                dataset['_id'],
                gc.get('viame_detection', parameters={'folderId': dataset['_id']}),
                summary,
            )
    print(summary)
    gc.post(
        'viame_summary',
        data=PublicDataSummary(label_summary_items=list(summary.values())).json(),
    )
