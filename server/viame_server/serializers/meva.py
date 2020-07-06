from boiler import models
from boiler.serialization import kpf

import csv
import json
import re
import io
from dataclasses import dataclass, field
from dacite import from_dict, Config
from typing import List, Dict, Tuple, Optional, Union, Any

from girder.models.file import File
from .viame import Track, Meva_Feature

class Detection(models.Detection):
    activity_id: int
    activity: str
    src_status: str
    timestamp: float
    

class Meva_Track(Track):
    """Meva Track represents MEVA data as track json"""
    actor_map: Optional[Dict[int, models.Actor]] = field(default_factory=lambda: {})
    activity_map: Optional[Dict[int, models.Activity]]

def load_kpf_as_tracks(ymls):
    types = None
    activity = None
    geom = None

    actor_map = {}
    activity_map = {}
    for file in ymls:
        yml = kpf.load_yaml(file)
        for row in yml:
            if kpf.TYPES in row:
                types = yml
                continue
            if kpf.GEOM in row:
                deserialize_geom(file, actor_map)
                print(actor_map)
                geom = yml
                continue
            if kpf.ACTIVITY in row:
                activity = yml
                continue

    if types:
        deserialize_types(types, actor_map)
    else:
        print("WARNING: types yaml was not given")
    if geom:
        deserialize_geom(geom, actor_map)
    else:
        print("WARNING: geom yaml was not given")
    if activity:
        deserialize_activities(activity, activity_map, actor_map)
    else:
        print("WARNING: activity yaml was not given")

    tracks = parse_actor_map_to_tracks(actor_map)
    return {trackId: track.asdict() for trackId, track in tracks.items()}


def parse_actor_map_to_tracks(actor_map):
    tracks = {}
    ids = {}
    i = 1
    for actor_id in actor_map:
        actor = actor_map[actor_id]
        for detection in actor.detections:
            bounds = [float(detection.box.left), float(detection.box.top), float(detection.box.right), float(detection.box.bottom)]
            feature = Meva_Feature(frame=detection.frame, bounds=bounds,
                                   actor_id=actor_id, cset=actor.actor_type, timestamp=detection.timestamp,
                                   activity_id=detection.activity_id, activity=detection.activity, status=detection.src_status)

            confidencePairs = []
            attributes = {}

            #How to split into tracks, currently does it by activity id
            if detection.activity_id not in ids:
                ids[detection.activity_id] = i
                tracks[i] = Track(detection.frame, detection.frame, i)
                i += 1
            track = tracks[ids[detection.activity_id]]
            track.begin = min(detection.frame, track.begin)
            track.end = max(track.end, detection.frame)
            track.features.append(feature)

            track.confidencePairs = confidence_pairs

            for (key, val) in attributes:
                track.attributes[key] = val
    return tracks


def deserialize_types(file, actor_map):
    kpf.deserialize_types(file, actor_map)


def deserialize_geom(file, actor_map):
    # kpf.deserialize_geom(file, actor_map)
    yml = kpf.load_yaml(file)
    for geom_packet in yml:
        if kpf.GEOM in geom_packet:
            geom = geom_packet[kpf.GEOM]
            actor_id = geom[kpf.ACTOR_ID]
            frame = geom[kpf.FRAME]
            timestamp = geom[kpf.SECONDS]
            box = geom[kpf.BOX]
            box = [int(n) for n in box.split(' ')]
            if len(box) != 4:
                raise BoilerError('expect bounding box to have 4 values')
            keyframe = False
            if kpf.KEYFRAME in geom:
                keyframe = geom[kpf.KEYFRAME]
            box = models.Box(left=box[0], top=box[1], right=box[2], bottom=box[3])
            detection = Detection(frame=frame, box=box, keyframe=keyframe, timestamp=timestamp)
            if actor_id in actor_map:
                actor_map[actor_id].detections.append(detection)
            else:
                actor_map[actor_id] = models.Actor(  # type: ignore
                    actor_id=actor_id, detections=[detection]
                )

def deserialize_activities(file, activity_map, actor_map):
    yml = kpf.load_yaml(file)
    for activity_packet in yml:
        if kpf.ACTIVITY in activity_packet:
            activity = _deserialize_activity(activity_packet, actor_map)
            activity_map[activity.activity_id] = activity

def _deserialize_activity(activity_packet, actor_map):
    """
    returns activity instanceActor(
    """
    activity = activity_packet[kpf.ACTIVITY]
    timespans = activity[kpf.TIMESPANS]
    frame_timespan = kpf._deserialize_frame_timespan(timespans)
    actors = activity[kpf.ACTORS]
    activity_type_obj = activity[kpf.ACTIVITY_TYPE]
    activity_type_keys = list(activity_type_obj.keys())
    if len(activity_type_keys) != 1:
        raise BoilerError(f'{activity_type_obj} should only have 1 key')
    activity_type = activity_type_keys[0]
    status = None
    if STATUS in activity:
        status = ActivityPipelineStatuses(activity['status'])

    for actor in actors:
        detections = actor_map[actor[kpf.ACTOR_ID]].detections
        for detection in detections:
            if detection.frame in range(frame_timespan[0], frame_timespan[1]):
                detection.activity = activity_type
                detection.activity_id = activity[kpf.ACTIVITY_ID]
                detection.src_status = activity[kpf.STATUS]

    return Activity(  # type: ignore
        activity_id=activity[kpf.ACTIVITY_ID],
        activity_type=activity_type,
        begin=frame_timespan[0],
        end=frame_timespan[1],
        status=status,
        actors=[kpf._deserialize_actor(a, actor_map) for a in actors],
    )


def serialize_types(actor_map: Dict[int, models.Actor]):
    kpf.serialize_types(actor_map)

def serialize_geom(actor_map: Dict[int, models.Actor]):
    kpf.serialize_geom(actor_map)

def serialize_activities(activity_map: Dict[int, models.Activity], actor_map: Dict[int, models.Actor]):
    kpf.serialize_activities(activity_map, actor_map)

def serialize_to_files(
    output_basename: str, activity_list: models.ActivityList, keyframes_only=False,
):
    kpf.serialize_to_files(output_basename, activity_list, keyframes_only)




