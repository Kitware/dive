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

def deserialize_types(file, actor_map):
	kpf.deserialize_types(file, actor_map)

def deserialize_geom(file, actor_map):
	kpf.deserialize_geom(file, actor_map)

def deserialize_activities(file, activity_map, actor_map):
	kpf.deserialize_activities(file, activity_map, actor_map)

def serialize_types(actor_map: Dict[int, Actor]):
	kpf.serialize_types(actor_map)

def serialize_geom(actor_map: Dict[int, Actor]):
	kpf.serialize_geom(actor_map)

def serialize_activities(activity_map: Dict[int, Activity], actor_map: Dict[int, Actor]):
	kpf.serialize_activities(activity_map, actor_map)

def serialize_to_files(
    output_basename: str, activity_list: ActivityList, keyframes_only=False,
):
	kpf.serialize_to_files(output_basename, activity_list, keyframes_only)




