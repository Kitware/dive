from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union


@dataclass
class Feature:
    """Feature represents a single detection in a track."""

    frame: int
    bounds: List[float]
    polygon: Optional[List[float]] = None
    head: Optional[Tuple[float, float]] = None
    tail: Optional[Tuple[float, float]] = None
    fishLength: Optional[float] = None
    attributes: Optional[Dict[str, Union[bool, float, str]]] = None
    interpolate: Optional[bool] = False
    keyframe: Optional[bool] = True

    def asdict(self):
        """Removes entries with values of `None`."""
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class Track:
    begin: int
    end: int
    trackId: int
    features: List[Feature] = field(default_factory=lambda: [])
    confidencePairs: List[Tuple[str, float]] = field(default_factory=lambda: [])
    attributes: Dict[str, Any] = field(default_factory=lambda: {})

    def asdict(self):
        """Used instead of `dataclasses.asdict` for better performance."""

        track_dict = dict(self.__dict__)
        track_dict["features"] = [
            feature.asdict() for feature in track_dict["features"]
        ]
        return track_dict

    def exceeds_thresholds(self, thresholds: Dict[str, float]) -> bool:
        defaultThresh = thresholds.get('default', 0)
        return any([
            confidence >= thresholds.get(field, defaultThresh)
            for field, confidence in self.confidencePairs])


# interpolate all features [a, b)
def interpolate(a: Feature, b: Feature) -> List[Feature]:
    if a.interpolate is False:
        raise ValueError('Cannot interpolate feature without interpolate enabled')
    if b.frame <= a.frame:
        raise ValueError('b.frame must be larger than a.frame')
    feature_list = [a]
    frame_range = b.frame - a.frame
    for frame in range(1, frame_range):
        delta = frame / frame_range
        inverse_delta = 1 - delta
        bounds: List[float] = [
            round((abox * delta) + (bbox * inverse_delta))
            for (abox, bbox) in zip(a.bounds, b.bounds)
        ]
        feature_list.append(Feature(frame=frame, bounds=bounds, keyframe=False,))
    return feature_list
