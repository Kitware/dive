from typing import Dict, List, Tuple

from pydantic import BaseModel

from dive_utils import constants, models


class TemporalBoundingBoxAnnotation(BaseModel):
    displayName: str
    timeOffset: str
    xMin: float
    xMax: float
    yMin: float
    yMax: float
    instanceId: str


class VideoAnnotation(BaseModel):
    videoGcsUri: str
    temporalBoundingBoxAnnotations: List[TemporalBoundingBoxAnnotation]


def load_video_tracking(data: str, width: int, height: int, fps: float) -> Tuple[str, dict, dict]:
    """
    https://cloud.google.com/vertex-ai/docs/datasets/prepare-video#object-tracking_2
    """
    tracks: Dict[int, models.Track] = {}
    video = VideoAnnotation.parse_raw(data)

    for detection in video.temporalBoundingBoxAnnotations:
        trackId = int(detection.instanceId)
        timestamp = float(detection.timeOffset[:-1])
        frame = timestamp * fps
        if frame != int(frame):
            raise ValueError(
                f'impossible FPS provided: {timestamp} * {fps}  = {frame} is not a whole number'
            )
        else:
            frame = int(frame)

        if trackId not in tracks:
            tracks[trackId] = models.Track(
                begin=frame,
                end=frame,
                trackId=trackId,
                confidencePairs=[[detection.displayName, 1.0]],
            )

        bounds = [
            int(detection.xMax * width),
            int(detection.yMin * height),
            int(detection.xMax * width),
            int(detection.yMax * height),
        ]
        feature = models.Feature(
            frame=frame, flick=timestamp * constants.FlickConstant, bounds=bounds
        )

        track = tracks[trackId]
        track.begin = min(frame, track.begin)
        track.end = max(track.end, frame)
        track.features.append(feature)

    track_json = {trackId: track.dict(exclude_none=True) for trackId, track in tracks.items()}
    return video.videoGcsUri, track_json, {}
