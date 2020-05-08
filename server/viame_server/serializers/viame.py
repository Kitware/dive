"""
VIAME Fish format deserializer
"""
import csv
import re

from girder.models.file import File


def _deduceType(value):
    if value == "true":
        return True
    if value == "false":
        return False
    try:
        number = float(value)
        return number
    except ValueError:
        return value


def parse(file):
    rows = (
        b"".join(list(File().download(file, headers=False)()))
        .decode("utf-8")
        .split("\n")
    )
    reader = csv.reader(row for row in rows if (not row.startswith("#") and row))
    detections = []
    for row in reader:
        features = {}
        attributes = {}
        track_attributes = {}

        confidence_pairs = [
            [row[i], float(row[i + 1])]
            for i in range(9, len(row), 2)
            if not row[i].startswith("(")
        ]
        start = len(row) - 1 if len(row) % 2 == 0 else len(row) - 2

        for j in range(start, len(row)):
            if row[j].startswith("(kp)"):
                if "head" in row[j]:
                    groups = re.match(r"\(kp\) head ([0-9]+) ([0-9]+)", row[j])
                    if groups:
                        features["head"] = (groups[1], groups[2])
                elif "tail" in row[j]:
                    groups = re.match(r"\(kp\) tail ([0-9]+) ([0-9]+)", row[j])
                    if groups:
                        features["tail"] = (groups[1], groups[2])
            if row[j].startswith("(atr)"):
                groups = re.match(r"\(atr\) (.+) (.+)", row[j])
                attributes[groups[1]] = _deduceType(groups[2])
            if row[j].startswith("(trk-atr)"):
                groups = re.match(r"\(trk-atr\) (.+) (.+)", row[j])
                track_attributes[groups[1]] = _deduceType(groups[2])
        detections.append(
            {
                "track": int(row[0]),
                "frame": int(row[2]),
                "bounds": [float(row[3]), float(row[5]), float(row[4]), float(row[6]),],
                "confidence": float(row[7]),
                "fishLength": float(row[8]),
                "confidencePairs": [],
                "features": {},
                "attributes": attributes if attributes else None,
                "trackAttributes": track_attributes if track_attributes else None,
            }
        )
    return detections
