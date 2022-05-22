"""
Support for the FathomNet JSON export schema.
https://medium.com/fathomnet/how-to-submit-localized-image-annotations-to-fathomnet-baf25dbd8165
"""
import os
from typing import Any, Dict, List, Optional, Tuple
import urllib.parse
from uuid import UUID

from pydantic import BaseModel, HttpUrl

from dive_utils import constants, models, types


class FathomNetBBox(BaseModel):
    uuid: UUID
    concept: str
    x: int
    y: int
    width: int
    height: int
    rejected: bool
    verified: bool
    observer: Optional[str]


class FathomNetImage(BaseModel):
    id: int
    uuid: UUID
    url: HttpUrl
    width: int
    height: int
    boundingBoxes: List[FathomNetBBox]
    # Optional
    imagingType: Optional[str]
    depthMeters: Optional[float]
    latitude: Optional[float]
    longitude: Optional[float]
    salinity: Optional[float]
    temperatureCelsius: Optional[float]
    oxygenMlL: Optional[float]
    pressureDbar: Optional[float]
    timestamp: Optional[str]


# FathomNet Optional Attributes Definitions
FATHOMNET_ATTRS = {
    'depthMeters': models.Attribute(
        belongs='track',
        datatype='text',
        name='depthMeters',
        key='depthMeters',
    ).dict(),
    'imageId': models.Attribute(
        belongs='track',
        datatype='number',
        name='imageId',
        key='imageId',
    ).dict(),
    'latitude': models.Attribute(
        belongs='track',
        datatype='number',
        name='latitude',
        key='latitude',
    ).dict(),
    'longitude': models.Attribute(
        belongs='track',
        datatype='number',
        name='longitude',
        key='longitude',
    ).dict(),
}


def is_fathomnet(jsonData: Any) -> bool:
    """Test if a python object represents FathomNet data"""
    try:
        if type(jsonData) is list:
            if len(jsonData) >= 1:
                if type(jsonData[1]) is dict:
                    FathomNetImage(**jsonData[0])
                    return True
    except Exception:
        return False
    return False


def load(jsonData: List[Dict[str, Any]]) -> List[FathomNetImage]:
    parsed: List[FathomNetImage] = []
    for imageData in jsonData:
        parsed.append(FathomNetImage(**imageData))
    return parsed


def convert(
    imageData: List[FathomNetImage],
) -> Tuple[types.DIVEAnnotationSchema, dict, List[types.ImportImage]]:
    tracks: Dict[str, dict] = {}
    groups: Dict[str, dict] = {}
    images: List[types.ImportImage] = []
    sortedImageData: List[FathomNetImage] = sorted(imageData, key=lambda img: img.id)
    trackNumber = 0
    for frameNumber, image in enumerate(sortedImageData):
        path = urllib.parse.urlparse(image.url).path
        img: types.ImportImage = {
            'url': image.url,
            'filename': f'{image.id}{os.path.splitext(path)[1]}',
        }
        images.append(img)
        for bbox in image.boundingBoxes:
            track = models.Track(
                id=trackNumber,
                begin=frameNumber,
                end=frameNumber,
                confidencePairs=[[bbox.concept, 1]],
                features=[
                    models.Feature(
                        frame=frameNumber,
                        bounds=[bbox.x, bbox.y, bbox.x + bbox.width, bbox.y + bbox.height],
                    )
                ],
                attributes={
                    'depthMeters': image.depthMeters,
                    'imageId': image.id,
                    'latitude': image.latitude,
                    'longitude': image.longitude,
                },
            )
            tracks[str(trackNumber)] = track.dict(exclude_none=True)
            trackNumber += 1
    return (
        {
            'tracks': tracks,
            'groups': groups,
            'version': constants.AnnotationsCurrentVersion,
        },
        models.MetadataMutable(attributes=FATHOMNET_ATTRS).dict(exclude_none=True),
        images,
    )
