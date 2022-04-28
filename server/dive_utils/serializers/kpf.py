"""
This is a pure python module for parsing MEVA KPF.  It has no third party dependencies
and does not import code from other places in this application.

It is the python implementation of client/platform/backend/serializers/kpf.ts
"""
from collections import defaultdict
from typing import ByteString, Dict, Iterable, List, Mapping, Tuple, TypedDict, cast

import yaml


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


def get_default_kpf_data() -> KPFData:
    return {
        'types': [],
        'geom': [],
        'activities': [],
        'actor_type_map': {},
        'actor_activity_map': defaultdict(list),
        'actor_geom_map': defaultdict(list),
    }


def load(readers: List[Iterable[ByteString]]) -> KPFData:
    """Load from files into formal data structures"""
    error_report = {}
    kpf_data = get_default_kpf_data()

    try:
        for file in readers:
            rows = b"".join(list(file)).decode("utf-8")
            parsed = yaml.safe_load(rows)
            for row in parsed:
                if 'types' in row:
                    kpf_data['types'].append(cast(KPFType, row['types']))
                elif 'geom' in row:
                    kpf_data['geom'].append(cast(KPFGeom, row['geom']))
                elif 'act' in row:
                    kpf_data['activities'].append(cast(KPFActivity, row['act']))

        for item in kpf_data['types']:
            kpf_data['actor_type_map'][item['id1']] = item
        for item in kpf_data['geom']:
            kpf_data['actor_geom_map'][item['id1']].append(item)
        for item in kpf_data['activities']:
            for actor in item['actors']:
                kpf_data['actor_activity_map'][actor['id1']].append(item)

        return kpf_data

    except Exception as e:
        error_report['error'] = str(e)
        return error_report

def convert(kpf_data: KPFData) -> Tuple[dict, dict]:
    """Convert kpf data to DIVE Json"""
    tracks: Dict[int, dict] = {}
    groups: Dict[int, dict] = {}

    for actorId in kpf_data['actor_geom_map'].keys():
        activities = kpf_data['actor_activity_map'][actorId]
        actorType = kpf_data['actor_type_map'][actorId]
        attributes = {
            'activityIds': ' '.join([a['act2'] for a in activities]),
            'srcStatus': ' '.join([a['src_status'] for a in activities]),
        }
        allActorInstances = [actor for act in activities for actor in act['actors'] if actor['id1'] == actorId]
        allRanges = [t for actor in allActorInstances for ts in actor['timespan'] for t in ts['tsr0']]
        begin = min(allRanges)
        end = max(allRanges)
        features: List[dict] = []
        confidencePairs = actorType['cset3'].items()
        for geom in kpf_data['actor_geom_map'][actorId]:
            if geom['keyframe']:
                features.append({
                    'frame': geom['ts0'],
                    'attributes': {},
                    'bounds': [float(a) for a in geom['g0'].split(' ')],
                    'interpolate': True,
                })
        tracks[actorType['id1']] = {
            'attributes': attributes,
            'id': actorType['id1'],
            'begin': begin,
            'end': end,
            'confidencePairs': confidencePairs,
            'features': sorted(features, key=lambda f: f['frame'])
        }


#      this.activities.forEach((activity) => {
#        const allRanges = flattenDeep(activity.timespan.map((v) => v.tsr0));
#        const confidencePairs: ConfidencePair[] = Object.entries(activity.act2);
#        const begin = Math.min(...allRanges);
#        const end = Math.max(...allRanges);
#        const members: GroupMembers = {};
#        activity.actors.forEach((actor) => {
#          members[actor.id1] = {
#            ranges: actor.timespan.map((t) => t.tsr0),
#          };
#        });
#        groups[activity.id2] = {
#          begin,
#          end,
#          members,
#          id: activity.id2,
#          confidencePairs,
#          attributes: {},
#        };
#      });

#      return {
#        tracks,
#        groups,
#      };
#    }

#    /**
#    * Return elements of list that have validKey defined
#    * @param {Array} list
#    * @param {String} validKey
#    */
#    static filterEmpty(list: any[], validKeyList: string[]) {
#      return list.filter((l) => validKeyList.some((e) => e in l));
#    }

#    /**
#    * Return elements where number key in range value
#    */
#    static filterRange(list: any[], key: string, lower: number, upper: number) {
#      return list.filter((item) => item[key] <= upper && item[key] >= lower);
#    }
