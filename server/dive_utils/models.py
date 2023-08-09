from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union

from bson.objectid import ObjectId
from pydantic import BaseModel, Field, validator
from typing_extensions import Literal

from dive_utils import constants


class PydanticObjectId(str):
    """https://stackoverflow.com/a/69431643"""

    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        return ObjectId(v)


class GeoJSONGeometry(BaseModel):
    type: str
    # support point, line, or polygon,
    coordinates: Union[List[float], List[List[float]], List[List[List[float]]]]


class GeoJSONFeature(BaseModel):
    type: str
    geometry: GeoJSONGeometry
    properties: Dict[str, Union[bool, float, str]]


class GeoJSONFeatureCollection(BaseModel):
    type: str
    features: List[GeoJSONFeature]


class Feature(BaseModel):
    """Feature represents a single detection in a track."""

    frame: int
    flick: Optional[int]
    bounds: List[int]
    attributes: Optional[Dict[str, Any]] = {}
    geometry: Optional[GeoJSONFeatureCollection] = None
    head: Optional[Tuple[float, float]] = None
    tail: Optional[Tuple[float, float]] = None
    fishLength: Optional[float] = None
    interpolate: Optional[bool] = None
    keyframe: Optional[bool] = None


class BaseAnnotation(BaseModel):
    begin: Optional[int]
    end: Optional[int]
    id: int
    confidencePairs: List[Tuple[str, float]] = Field(default_factory=lambda: [])
    attributes: Dict[str, Any] = Field(default_factory=lambda: {})
    meta: Optional[Dict[str, Any]]

    def exceeds_thresholds(self, thresholds: Dict[str, float]) -> bool:
        defaultThresh = thresholds.get('default', 0)
        return any(
            [
                confidence >= thresholds.get(field, defaultThresh)
                for field, confidence in self.confidencePairs
            ]
        )

    def __hash__(self):
        return self.id


class Track(BaseAnnotation):
    begin: int
    end: int
    features: List[Feature] = Field(default_factory=lambda: [])

    @validator('features')
    @classmethod
    def validateFeatures(cls, v: List[Feature], values: dict):
        if len(v) > 0:
            trackId = values.get('id')
            begin = values.get('begin')
            end = values.get('end')
            if v[0].frame != begin:
                raise ValueError(
                    f'trackId={trackId} begin={begin} does not match features[0]={v[0].frame}'
                )
            if v[-1].frame != end:
                raise ValueError(
                    f'trackId={trackId} end={end} does not match features[-1]={v[-1].frame}'
                )
        return v


class GroupMember(BaseModel):
    ranges: List[List[int]]


class Group(BaseAnnotation):
    # Mongo keys must be strings, but the members key is an int.
    # The client is responsible for converting it.
    members: Dict[str, GroupMember]


class TrackItemSchema(Track):
    dataset: PydanticObjectId
    rev_created: int = 0
    rev_deleted: Optional[int]


class GroupItemSchema(Group):
    dataset: PydanticObjectId
    rev_created: int = 0
    rev_deleted: Optional[int]


class RevisionLog(BaseModel):
    dataset: PydanticObjectId
    author_id: PydanticObjectId
    author_name: str
    revision: int
    additions: int = 0
    deletions: int = 0
    created: datetime = Field(default_factory=datetime.utcnow)
    description: Optional[str]


class NumericAttributeOptions(BaseModel):
    type: Literal['combo', 'slider']
    range: Optional[List[float]]
    steps: Optional[float]


class StringAttributeOptions(BaseModel):
    type: Literal['locked', 'freeform']


class RenderingDisplayDimension(BaseModel):
    type: Literal['px', '%', 'auto']
    val: float


class RenderingAttributes(BaseModel):
    typeFilter: List[str]
    selected: Optional[bool]
    displayName: str
    displayColor: str
    displayTextSize: float
    valueColor: str
    valueTextSize: str
    order: int
    location: Literal['inside', 'outside']
    corner: Optional[Literal['SW', 'SE', 'NW']]
    box: bool
    boxColor: str
    boxThickness: float
    boxBackground: Optional[str]
    boxOpacity: Optional[float]
    layout: Literal['vertical', 'horizontal']
    displayWidth: RenderingDisplayDimension
    displayHeight: RenderingDisplayDimension


class Attribute(BaseModel):
    belongs: Literal['track', 'detection']
    datatype: Literal['text', 'number', 'boolean']
    values: Optional[List[str]]
    valueColors: Optional[Dict[str, str]]
    name: str
    key: str
    color: Optional[str]
    user: Optional[bool]
    editor: Optional[Union[NumericAttributeOptions, StringAttributeOptions]]
    render: Optional[RenderingAttributes]


class CustomStyle(BaseModel):
    color: Optional[str]
    strokeWidth: Optional[float]
    opacity: Optional[float]
    fill: Optional[bool]
    showLabel: Optional[bool]
    showConfidence: Optional[bool]


class MetadataMutable(BaseModel):
    version = (
        constants.JsonMetaCurrentVersion
    )  # maintain compatibility with desktop for the subset of fields that overlap.
    customTypeStyling: Optional[Dict[str, CustomStyle]]
    customGroupStyling: Optional[Dict[str, CustomStyle]]
    confidenceFilters: Optional[Dict[str, float]]
    attributes: Optional[Dict[str, Attribute]]

    @staticmethod
    def is_dive_configuration(value: dict):
        """
        Check if value is a configuration file if at lease one of the config options is populated
        """
        keys = list(MetadataMutable.schema()['properties'].keys())

        # Remove version: its appearance is not enough to indicate that
        # the value is actually a configuration object.
        keys.remove("version")

        return any([value.get(key, False) for key in keys])


class GirderMetadataStatic(MetadataMutable):
    # Required
    id: str
    name: str
    createdAt: str
    type: str
    # Casting order matters, float first, then fall back to int
    fps: Union[float, int]
    annotate: bool

    # Optional
    # Casting order matters, float first, then fall back to int
    originalFps: Optional[Union[float, int]]
    ffprobe_info: Optional[Dict[str, Any]]
    foreign_media_id: Optional[str]


class MediaResource(BaseModel):
    url: str
    id: str
    filename: str


class DatasetSourceMedia(BaseModel):
    imageData: List[MediaResource]
    video: Optional[MediaResource]


class PrivateQueueEnabledResponse(BaseModel):
    enabled: bool
    token: Optional[dict]


class CocoMetadata(BaseModel):
    categories: Dict[int, dict]
    keypoint_categories: Dict[int, dict]
    images: Dict[int, dict]
    videos: Dict[int, dict]


class BrandData(BaseModel):
    vuetify: Optional[dict]
    favicon: Optional[str]
    logo: Optional[str]
    name: Optional[str]
    loginMessage: Optional[str]
    alertMessage: Optional[str]
    trainingMessage: Optional[str]

    class Config:
        extra = 'forbid'


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
            round((abox * inverse_delta) + (bbox * delta))
            for (abox, bbox) in zip(a.bounds, b.bounds)
        ]
        feature_list.append(Feature(frame=a.frame + frame, bounds=bounds, keyframe=False))
    return feature_list
