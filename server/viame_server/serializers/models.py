from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union


@dataclass
class GeoJSONGeometry:
    type: str
    coordinates: Union[List[List[float]], List[List[List[float]]]]


@dataclass
class GeoJSONFeature:
    type: str
    geometry: GeoJSONGeometry
    properties: Dict[str, Union[bool, float, str]]


@dataclass
class GeoJSONFeatureCollection:
    type: str
    features: List[GeoJSONFeature]


@dataclass
class Feature:
    """Feature represents a single detection in a track."""

    frame: int
    bounds: List[float]
    geometry: Optional[GeoJSONFeatureCollection] = None
    head: Optional[Tuple[float, float]] = None
    tail: Optional[Tuple[float, float]] = None
    fishLength: Optional[float] = None
    attributes: Optional[Dict[str, Union[bool, float, str]]] = None
    interpolate: Optional[bool] = False
    keyframe: Optional[bool] = True


@dataclass
class Track:
    begin: int
    end: int
    trackId: int
    features: List[Feature] = field(default_factory=lambda: [])
    confidencePairs: List[Tuple[str, float]] = field(default_factory=lambda: [])
    attributes: Dict[str, Any] = field(default_factory=lambda: {})

    def exceeds_thresholds(self, thresholds: Dict[str, float]) -> bool:
        defaultThresh = thresholds.get('default', 0)
        return any(
            [
                confidence >= thresholds.get(field, defaultThresh)
                for field, confidence in self.confidencePairs
            ]
        )


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
        feature_list.append(
            Feature(frame=a.frame + frame, bounds=bounds, keyframe=False)
        )
    return feature_list
