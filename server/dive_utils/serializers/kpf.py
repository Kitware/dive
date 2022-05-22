"""
This is a pure python module for parsing MEVA KPF.  It has no third party dependencies
and does not import code from other places in this application.

It is the python implementation of client/platform/backend/serializers/kpf.ts
"""
from collections import defaultdict
from typing import Dict, List, Mapping, Tuple, TypedDict, cast

import yaml

from dive_utils import constants, models, types


class KPFType(TypedDict):
    cset3: Mapping[str, float]
    id1: int


class KPFGeom(TypedDict):
    g0: str
    id0: int
    id1: int
    keyframe: bool
    ts0: int  # frame number


class KPFTimespan(TypedDict):
    tsr0: List[int]


class KPFActor(TypedDict):
    id1: int
    timespan: List[KPFTimespan]


class KPFActivity(TypedDict):
    id2: int
    src_status: str
    act2: Mapping[str, int]
    actors: List[KPFActor]
    timespan: List[KPFTimespan]


class KPFData(TypedDict):
    types: List[KPFType]
    geom: List[KPFGeom]
    activities: List[KPFActivity]
    actor_type_map: Dict[int, KPFType]
    actor_activity_map: Dict[int, List[KPFActivity]]
    actor_geom_map: Dict[int, List[KPFGeom]]


def flatten(container):
    for i in container:
        if isinstance(i, (list, tuple)):
            for j in flatten(i):
                yield j
        else:
            yield i


def get_default_kpf_data() -> KPFData:
    return {
        'types': [],
        'geom': [],
        'activities': [],
        'actor_type_map': {},
        'actor_activity_map': defaultdict(list),
        'actor_geom_map': defaultdict(list),
    }


def load(input: str) -> KPFData:
    """Load from files into formal data structures"""
    kpf_data = get_default_kpf_data()
    parsed = yaml.safe_load(input)
    for row in parsed:
        if 'types' in row:
            kpf_data['types'].append(cast(KPFType, row['types']))
        elif 'geom' in row:
            kpf_data['geom'].append(cast(KPFGeom, row['geom']))
        elif 'act' in row:
            kpf_data['activities'].append(cast(KPFActivity, row['act']))

    for typeval in kpf_data['types']:
        kpf_data['actor_type_map'][typeval['id1']] = typeval
    for geomval in kpf_data['geom']:
        kpf_data['actor_geom_map'][geomval['id1']].append(geomval)
    for activityval in kpf_data['activities']:
        for actor in activityval['actors']:
            kpf_data['actor_activity_map'][actor['id1']].append(activityval)

    return kpf_data


def convert(kpf_data: KPFData) -> Tuple[types.DIVEAnnotationSchema, dict]:
    """Convert kpf data to pre-validated DIVE Json"""
    tracks: Dict[str, dict] = {}
    groups: Dict[str, dict] = {}
    attribute_definitions = {
        'srcStatus': models.Attribute(
            **{
                'belongs': 'track',
                'datatype': 'text',
                'name': 'srcStatus',
                'key': 'srcStatus',
            }
        ).dict(),
        'activityIds': models.Attribute(
            **{
                'belongs': 'track',
                'datatype': 'text',
                'name': 'activityIds',
                'key': 'activityIds',
            }
        ).dict(),
    }

    for actorId in kpf_data['actor_geom_map'].keys():
        activities = kpf_data['actor_activity_map'][actorId]
        actorType = kpf_data['actor_type_map'][actorId]
        attributes = {
            'activityIds': ' '.join([str(a['id2']) for a in activities]),
            'srcStatus': ' '.join([str(a['src_status']) for a in activities]),
        }
        allActorInstances = [
            actor for act in activities for actor in act['actors'] if actor['id1'] == actorId
        ]
        allRanges = [
            t for actor in allActorInstances for ts in actor['timespan'] for t in ts['tsr0']
        ]
        begin = min(allRanges)
        end = max(allRanges)
        features: List[dict] = []
        confidencePairs = list(actorType['cset3'].items())
        for geom in kpf_data['actor_geom_map'][actorId]:
            if geom['keyframe']:
                features.append(
                    {
                        'frame': geom['ts0'],
                        'attributes': {},
                        'bounds': [float(a) for a in geom['g0'].split(' ')],
                        'interpolate': True,
                    }
                )
        tracks[str(actorType['id1'])] = models.Track(
            **{
                'attributes': attributes,
                'id': actorType['id1'],
                'begin': begin,
                'end': end,
                'confidencePairs': confidencePairs,
                'features': sorted(features, key=lambda f: f['frame']),
            }
        ).dict(exclude_none=True)

        for activity in kpf_data['activities']:
            all_ranges = list(flatten([a['tsr0'] for a in activity['timespan']]))
            confidence_pairs = list(activity['act2'].items())
            begin = min(all_ranges)
            end = max(all_ranges)
            members: Dict[int, dict] = {}
            for actor in activity['actors']:
                members[actor['id1']] = {
                    'ranges': [a['tsr0'] for a in actor['timespan']],
                }
            groups[str(activity['id2'])] = models.Group(
                begin=begin,
                end=end,
                members=members,
                id=activity['id2'],
                confidencePairs=confidence_pairs,
                attributes={},
            ).dict(exclude_none=True)

    return {
        'tracks': dict(sorted(tracks.items())),
        'groups': dict(sorted(groups.items())),
        'version': constants.AnnotationsCurrentVersion,
    }, models.MetadataMutable(attributes=attribute_definitions).dict(exclude_none=True)
