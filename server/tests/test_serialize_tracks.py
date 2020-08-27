import csv
import io
import os
from viame_server.serializers import viame, models


def test_serialize_tracks():
    sio = io.StringIO()
    writer = csv.writer(sio)
    features = [
        {"frame": 1, "bounds": [2, 2, 4, 4], "interpolate": True, "keyframe": True},
        {"frame": 4, "bounds": [4, 4, 8, 8], "interpolate": True, "keyframe": True},
    ]
    track = {
        "begin": 1,
        "end": 4,
        "trackId": 0,
        "features": features,
        "confidencePairs": [["foo", 0.2], ["bar", 0.9], ["baz", 0.1]],
    }
    last_frame = 0
    for line in viame.export_tracks_as_csv({1: track}):
        cols = line.split(',')
        frame = int(cols[2])
        confidence = float(cols[7])
        assert frame == last_frame + 1
        assert confidence == 0.9
        last_frame = frame

