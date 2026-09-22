# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "click",
#     "faker",
# ]
# ///
"""Generate a DIVE scoring sample dataset with ground truth and test data."""

from __future__ import annotations

import json
import math
import random
import subprocess
from pathlib import Path
from typing import Optional

import click
from faker import Faker

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
VIDEO_FPS = 30

DEFAULT_TYPE_COLORS = [
    "#4CAF50",
    "#F44336",
    "#9E9E9E",
    "#FF9800",
    "#795548",
    "#2196F3",
    "#E91E63",
    "#9C27B0",
    "#00BCD4",
    "#8BC34A",
]


def generate_track_types(count: int, seed: int) -> list[str]:
    """Return ``count`` unique lowercase type names from Faker."""
    fake = Faker()
    fake.seed_instance(seed)
    types: set[str] = set()
    while len(types) < count:
        types.add(fake.word().lower())
    return sorted(types)


def type_colors(count: int) -> list[str]:
    """Return ``count`` distinct hex colors for custom type styling."""
    if count <= len(DEFAULT_TYPE_COLORS):
        return DEFAULT_TYPE_COLORS[:count]
    colors = list(DEFAULT_TYPE_COLORS)
    for i in range(len(DEFAULT_TYPE_COLORS), count):
        hue = (i * 137.508) % 360
        colors.append(_hsl_to_hex(hue, 0.65, 0.5))
    return colors


def _hsl_to_hex(h: float, s: float, lightness: float) -> str:
    c = (1 - abs(2 * lightness - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = lightness - c / 2
    if h < 60:
        r, g, b = c, x, 0
    elif h < 120:
        r, g, b = x, c, 0
    elif h < 180:
        r, g, b = 0, c, x
    elif h < 240:
        r, g, b = 0, x, c
    elif h < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    return "#{:02X}{:02X}{:02X}".format(
        int((r + m) * 255),
        int((g + m) * 255),
        int((b + m) * 255),
    )


def create_video(path: Path, duration_seconds: int) -> None:
    """Create an H.264 MP4 that DIVE can play without transcoding."""
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"testsrc=size={FRAME_WIDTH}x{FRAME_HEIGHT}:rate={VIDEO_FPS}",
        "-t",
        str(duration_seconds),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-profile:v",
        "main",
        "-movflags",
        "+faststart",
        "-aspect",
        "16:9",
        str(path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def rectangle_bounds(cx: float, cy: float, half_size: float) -> list[int]:
    """Return axis-aligned rectangle bounds [x1, y1, x2, y2]."""
    return [
        int(round(cx - half_size)),
        int(round(cy - half_size)),
        int(round(cx + half_size)),
        int(round(cy + half_size)),
    ]


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def build_track(
    track_id: int,
    begin: int,
    end: int,
    rng: random.Random,
    track_types: list[str],
    *,
    confidence: Optional[float] = None,
) -> dict:
    track_type = rng.choice(track_types)
    if confidence is None:
        confidence = round(rng.uniform(0.75, 0.99), 3)

    margin = 80
    x = rng.uniform(margin, FRAME_WIDTH - margin)
    y = rng.uniform(margin, FRAME_HEIGHT - margin)
    dx = rng.choice([-4.0, -3.0, 3.0, 4.0])
    dy = rng.choice([-3.0, -2.0, 2.0, 3.0])
    base_size = rng.uniform(35, 90)
    growth_rate = rng.uniform(0.04, 0.12)

    features = []
    for frame in range(begin, end + 1):
        x += dx
        y += dy
        if x < margin or x > FRAME_WIDTH - margin:
            dx *= -1
            x = clamp(x, margin, FRAME_WIDTH - margin)
        if y < margin or y > FRAME_HEIGHT - margin:
            dy *= -1
            y = clamp(y, margin, FRAME_HEIGHT - margin)

        half_size = base_size * (0.75 + 0.25 * (1 + math.sin(growth_rate * frame)))
        features.append({
            "frame": frame,
            "bounds": rectangle_bounds(x, y, half_size),
        })

    return {
        "id": track_id,
        "confidencePairs": [[track_type, confidence]],
        "begin": begin,
        "end": end,
        "features": features,
    }


def build_ground_truth_tracks(
    rng: random.Random,
    num_frames: int,
    num_tracks: int,
    track_types: list[str],
) -> dict:
    tracks = {}
    occupied = []

    slot_count = num_tracks
    slot_size = max(1, num_frames // slot_count)
    min_duration = max(5, num_frames // 12)
    max_duration = max(min_duration + 1, min(num_frames - 1, num_frames // 2))

    for track_id in range(num_tracks):
        duration = rng.randint(min_duration, max_duration)
        slot_begin = (track_id * slot_size) + rng.randint(
            0, max(0, slot_size // 3)
        )
        latest_start = max(0, num_frames - duration - 1)
        begin = min(slot_begin, latest_start)
        if track_id < min(6, num_tracks):
            begin = 0
        end = min(num_frames - 1, begin + duration)

        for _ in range(20):
            overlap = sum(1 for b, e in occupied if not (end < b or begin > e))
            if overlap < 3:
                break
            begin = min(rng.randint(0, latest_start), latest_start)
            if track_id < min(6, num_tracks):
                begin = 0
            end = min(num_frames - 1, begin + duration)
        occupied.append((begin, end))

        tracks[str(track_id)] = build_track(
            track_id,
            begin,
            end,
            rng,
            track_types,
        )
    return tracks


def shift_bounds(
    bounds: list, dx: float, dy: float, scale: float = 1.0
) -> list:
    x1, y1, x2, y2 = bounds
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    half_w = (x2 - x1) / 2 * scale
    half_h = (y2 - y1) / 2 * scale
    return [
        int(round(cx - half_w + dx)),
        int(round(cy - half_h + dy)),
        int(round(cx + half_w + dx)),
        int(round(cy + half_h + dy)),
    ]


def mutation_list(num_tracks: int) -> list[str]:
    """Build a shuffled list of test mutations scaled to ``num_tracks``."""
    matched = max(0, num_tracks - 3)
    if matched == 0:
        return []
    scale = matched / 17
    counts = {
        "high_iou": max(1, round(8 * scale)),
        "marginal_iou": max(0, round(4 * scale)),
        "low_iou": max(0, round(2 * scale)),
        "label_swap": max(0, round(2 * scale)),
        "shortened": max(0, round(2 * scale)),
    }
    mutations: list[str] = []
    for name, count in counts.items():
        mutations.extend([name] * count)
    while len(mutations) < matched:
        mutations.append("high_iou")
    return mutations[:matched]


def mutate_track_for_test(
    gt_track: dict,
    rng: random.Random,
    mutation: str,
    track_types: list[str],
) -> dict:
    track = json.loads(json.dumps(gt_track))

    if mutation == "high_iou":
        dx, dy = rng.uniform(-8, 8), rng.uniform(-8, 8)
        scale = rng.uniform(0.92, 1.05)
        confidence = round(rng.uniform(0.7, 0.95), 3)
    elif mutation == "marginal_iou":
        dx, dy = rng.uniform(-25, 25), rng.uniform(-25, 25)
        scale = rng.uniform(0.75, 0.9)
        confidence = round(rng.uniform(0.45, 0.7), 3)
    elif mutation == "low_iou":
        dx, dy = rng.uniform(-60, 60), rng.uniform(-60, 60)
        scale = rng.uniform(0.55, 0.75)
        confidence = round(rng.uniform(0.35, 0.6), 3)
    elif mutation == "label_swap":
        dx, dy = rng.uniform(-6, 6), rng.uniform(-6, 6)
        scale = rng.uniform(0.95, 1.02)
        confidence = round(rng.uniform(0.65, 0.9), 3)
        current = track["confidencePairs"][0][0]
        alternatives = [t for t in track_types if t != current]
        track["confidencePairs"] = [[rng.choice(alternatives), confidence]]
    elif mutation == "shortened":
        dx, dy = rng.uniform(-10, 10), rng.uniform(-10, 10)
        scale = rng.uniform(0.9, 1.0)
        confidence = round(rng.uniform(0.6, 0.9), 3)
        trim = rng.randint(3, 8)
        track["begin"] += trim
        track["features"] = [
            f for f in track["features"] if f["frame"] >= track["begin"]
        ]
        if track["features"]:
            track["end"] = track["features"][-1]["frame"]
    else:
        dx, dy, scale = 0.0, 0.0, 1.0
        confidence = track["confidencePairs"][0][1]

    if mutation != "label_swap" and track["confidencePairs"]:
        label = track["confidencePairs"][0][0]
        track["confidencePairs"] = [[label, confidence]]

    for feature in track["features"]:
        feature["bounds"] = shift_bounds(feature["bounds"], dx, dy, scale)

    return track


def build_test_tracks(
    gt_tracks: dict,
    rng: random.Random,
    num_frames: int,
    num_tracks: int,
    track_types: list[str],
) -> dict:
    mutations = mutation_list(num_tracks)
    rng.shuffle(mutations)

    test_tracks = {}
    next_id = 1000

    gt_ids = sorted(gt_tracks.keys(), key=int)
    omit_count = min(3, len(gt_ids))
    omitted = set(rng.sample(gt_ids, omit_count)) if omit_count else set()

    for gt_id in gt_ids:
        if gt_id in omitted:
            continue
        mutation = mutations.pop() if mutations else "high_iou"
        test_tracks[gt_id] = mutate_track_for_test(
            gt_tracks[gt_id], rng, mutation, track_types
        )

    false_positive_count = max(1, num_tracks // 4)
    min_duration = max(5, num_frames // 15)
    max_duration = max(min_duration + 1, min(num_frames - 1, num_frames // 3))
    for _ in range(false_positive_count):
        duration = rng.randint(min_duration, max_duration)
        begin = rng.randint(0, max(0, num_frames - duration - 1))
        end = min(num_frames - 1, begin + duration)
        test_tracks[str(next_id)] = build_track(
            next_id,
            begin,
            end,
            rng,
            track_types,
            confidence=round(rng.uniform(0.4, 0.85), 3),
        )
        next_id += 1

    return test_tracks


def write_dive_json(tracks: dict, path: Path, fps: int = VIDEO_FPS) -> None:
    payload = {
        "version": 2,
        "fps": fps,
        "tracks": tracks,
        "groups": {},
    }
    path.write_text(
        json.dumps(payload, separators=(",", ":")),
        encoding="utf-8",
    )


def write_config(path: Path, track_types: list[str]) -> None:
    colors = type_colors(len(track_types))
    payload = {
        "version": 1,
        "confidenceFilters": {
            "default": 0.1,
            **{track_type: 0.5 for track_type in track_types},
        },
        "customTypeStyling": {
            track_type: {"color": color}
            for track_type, color in zip(track_types, colors)
        },
    }
    path.write_text(
        json.dumps(payload, separators=(",", ":")),
        encoding="utf-8",
    )


@click.command()
@click.option(
    "--output",
    "-o",
    default="./scoring-sample",
    show_default=True,
    type=click.Path(file_okay=False),
    help="Output directory for the generated dataset",
)
@click.option(
    "--types",
    "-n",
    default=5,
    show_default=True,
    type=click.IntRange(1),
    help="Number of distinct track types (names generated with Faker)",
)
@click.option(
    "--tracks",
    "-t",
    default=20,
    show_default=True,
    type=click.IntRange(1),
    help="Number of ground-truth tracks",
)
@click.option(
    "--duration",
    "-d",
    default=120,
    show_default=True,
    type=click.IntRange(1),
    help="Video duration in seconds",
)
@click.option(
    "--seed",
    default=42,
    show_default=True,
    help="Random seed for reproducible output",
)
def main(
    output: str, types: int, tracks: int, duration: int, seed: int
) -> None:
    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)
    video_path = output_dir / "sample_video.mp4"

    track_types = generate_track_types(types, seed)
    rng = random.Random(seed)
    num_frames = duration * VIDEO_FPS

    click.echo(f"Track types: {', '.join(track_types)}")
    click.echo(f"Creating video at {video_path} ...")
    create_video(video_path, duration)

    click.echo("Building ground truth annotations ...")
    gt_tracks = build_ground_truth_tracks(rng, num_frames, tracks, track_types)
    write_dive_json(gt_tracks, output_dir / "ground_truth.dive.json")
    # DIVE auto-discovers result*.json beside the video during import.
    write_dive_json(gt_tracks, output_dir / "result.json")

    click.echo("Building test run annotations ...")
    test_rng = random.Random(seed + 1)
    test_tracks = build_test_tracks(
        gt_tracks, test_rng, num_frames, tracks, track_types
    )
    write_dive_json(test_tracks, output_dir / "test.dive.json")

    write_config(output_dir / "config.json", track_types)

    click.echo("Done.")
    click.echo(
        f"  Video: {video_path.name} ({duration}s, H.264, {VIDEO_FPS} fps)"
    )
    click.echo(f"  Ground truth tracks: {len(gt_tracks)}")
    click.echo(f"  Test tracks: {len(test_tracks)}")
    click.echo(f"  Annotation fps: {VIDEO_FPS} ({num_frames} frames)")
    click.echo(f"  Output: {output_dir.resolve()}")


if __name__ == "__main__":
    main()
