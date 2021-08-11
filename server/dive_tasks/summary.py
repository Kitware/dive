from typing import Any, Dict, Set

from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task

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


def generate_max_n_summary(trackData: Dict[str, Any]):
    enabled: Set[str] = set()  # the tracks that are active on the current frame

    maxN: Dict[str, Dict[str, int]] = {}  # map type to tuple (frame, count)
    currentN: Dict[str, int] = {}

    for trackdict in sorted(trackData.values(), key=lambda item: item['begin']):
        currentFrame = trackdict.get('begin')
        trackType = sorted(
            trackdict.get('confidencePairs', ['unknown', 1]),
            key=lambda item: item[1],
            reverse=True,
        )[0][0]

        # Decrement tracks that need to be turned off before the next count round
        for enabledtrackId in list(enabled):
            enabledtrackdict = trackData[str(enabledtrackId)]
            if enabledtrackdict.get('end') < currentFrame:
                enabled.remove(enabledtrackId)
                enabledTrackType = sorted(
                    enabledtrackdict.get('confidencePairs', ['unknown', 1]),
                    key=lambda item: item[1],
                    reverse=True,
                )[0][0]
                currentN[enabledTrackType] -= 1

        # Figure out if we're at a global maximum
        currentN[trackType] = currentN.get(trackType, 0) + 1  # Increment the current
        currentMax = maxN.get(trackType, {"frame": 0, "count": 0})
        if currentN[trackType] > currentMax["count"]:
            maxN[trackType] = {"frame": currentFrame, "count": currentN[trackType]}

        enabled.add(str(trackdict['trackId']))

    return maxN


@app.task(bind=True, acks_late=True)
def generate_summary(self: Task):
    gc: GirderClient = self.girder_client

    limit = 50
    offset = 0
    total = int(
        gc.get(
            'dive_dataset',
            parameters={'limit': 1, PublishedMarker: True},
            jsonResp=False,
        ).headers['girder-total-count']
    )
    print(limit, offset, total)

    summary: Dict[str, SummaryItemSchema] = {}
    while offset < total:
        page = gc.get(
            'dive_dataset',
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
        'dive_summary',
        data=PublicDataSummary(label_summary_items=list(summary.values())).json(),
    )
