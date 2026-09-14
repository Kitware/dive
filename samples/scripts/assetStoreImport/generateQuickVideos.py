# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "click",
#     "faker",
# ]
# ///
import subprocess
import shutil
import random
import json
import math
from pathlib import Path
import click
from faker import Faker

fake = Faker()

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
FPS = 30


def create_base_video(file_path: Path, duration: int):
    """Create a single base test video using ffmpeg (MP4 container, H.264 codec)."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=size={FRAME_WIDTH}x{FRAME_HEIGHT}:rate={FPS}",
        "-t", str(duration),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        str(file_path)
    ]
    subprocess.run(cmd, check=True)


def copy_video_to_new_location(base_video: Path, target_path: Path):
    """Copy the base video to a new file path."""
    shutil.copy2(base_video, target_path)


# ---- Geometry + Annotations ----

def generate_star_points(cx, cy, r, spikes=5):
    pts = []
    angle = math.pi / spikes
    for i in range(2 * spikes):
        radius = r if i % 2 == 0 else r / 2
        x = cx + math.cos(i * angle) * radius
        y = cy + math.sin(i * angle) * radius
        pts.append([x, y])
    pts.append(pts[0])
    return pts


def generate_diamond_points(cx, cy, r):
    return [
        [cx, cy - r],
        [cx + r, cy],
        [cx, cy + r],
        [cx - r, cy],
        [cx, cy - r],
    ]


def generate_circle_points(cx, cy, r, segments=12):
    pts = []
    for i in range(segments + 1):
        angle = 2 * math.pi * i / segments
        x = cx + math.cos(angle) * r
        y = cy + math.sin(angle) * r
        pts.append([x, y])
    return pts


def generate_geometry(shape: str, cx: float, cy: float, size: float):
    if shape == "star":
        coords = generate_star_points(cx, cy, size)
    elif shape == "diamond":
        coords = generate_diamond_points(cx, cy, size)
    elif shape == "circle":
        coords = generate_circle_points(cx, cy, size)
    else:  # rectangle fallback
        half = size
        coords = [
            [cx-half, cy-half],
            [cx+half, cy-half],
            [cx+half, cy+half],
            [cx-half, cy+half],
            [cx-half, cy-half]
        ]
    return {'geojson': {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [coords]
                },
                "properties": { "key": "" }
            }
        ]
    },
    'coords': coords
    }


def geometry_bounds(coords):
    xs = [pt[0] for pt in coords]
    ys = [pt[1] for pt in coords]
    return [min(xs), min(ys), max(xs), max(ys)]


def generate_annotation_json(num_frames: int, output_file: Path):
    """Generate annotation JSON with moving/scaling geometry."""
    num_tracks = random.randint(3, 5)
    tracks = {}

    for i in range(num_tracks):
        track_id = i
        shape_type = random.choice(["circle", "rectangle", "diamond", "star"])
        begin = 0
        end = num_frames - 1

        x, y = random.randint(100, FRAME_WIDTH-100), random.randint(100, FRAME_HEIGHT-100)
        dx, dy = random.choice([-5, 5]), random.choice([-3, 3])
        base_size = random.randint(40, 80)
        growth_rate = random.uniform(0.05, 0.15)

        features = []
        for frame in range(num_frames):
            x += dx
            y += dy
            if x < 50 or x > FRAME_WIDTH-50:
                dx *= -1
                x += dx
            if y < 50 or y > FRAME_HEIGHT-50:
                dy *= -1
                y += dy

            scale = 0.5 * (1 + math.sin(growth_rate * frame))
            size = base_size * (0.75 + 0.5 * scale)

            output_data = generate_geometry(shape_type, x, y, size)
            geom = output_data['geojson']
            coords = output_data['coords']
            bounds = geometry_bounds(coords)

            feature = {
                "frame": frame,
                "bounds": bounds,
                "keyframe": True,
                "geometry": geom
            }
            features.append(feature)

        tracks[str(track_id)] = {
            "id": track_id,
            "meta": {"shape": shape_type},
            "attributes": {},
            "confidencePairs": [[fake.word(), float(random.randrange(0, 100)/100)]],
            "begin": begin,
            "end": end,
            "features": features
        }

    annotation = {
        "tracks": tracks,
        "groups": {},
        "version": 2
    }
    with open(output_file, "w") as f:
        json.dump(annotation, f, indent=2)


# ---- Main orchestration ----

@click.command()
@click.option('--output', '-o', default='./sample', show_default=True,
              type=click.Path(file_okay=False), help="Base output directory")
@click.option('--folders', '-f', default=3, show_default=True,
              help="Number of top-level folders to create")
@click.option('--max-depth', '-d', default=2, show_default=True,
              help="Maximum subfolder depth")
@click.option('--videos', '-v', default=4, show_default=True,
              help="Number of videos per folder")
@click.option('--total', '-t', default=50, show_default=True,
              help="Total number of videos to create")
@click.option('--duration', default=10, show_default=True,
              help="Duration (in seconds) of each video")
def main(output, folders, max_depth, videos, total, duration):
    base_path = Path(output)
    base_path.mkdir(parents=True, exist_ok=True)

    # Create one base video
    base_video = base_path / "base_video.mp4"
    click.echo(f"Creating base video of {duration}s...")
    create_base_video(base_video, duration)

    num_frames = duration * FPS
    count = 0
    for f in range(folders):
        if count >= total:
            break
        folder_path = base_path / fake.word()
        folder_path.mkdir(parents=True, exist_ok=True)

        stack = [(folder_path, 1)]
        while stack and count < total:
            current_path, depth = stack.pop()

            for _ in range(videos):
                if count >= total:
                    break
                name = fake.word()
                video_path = current_path / f"{name}.mp4"
                json_path = current_path / f"{name}.json"

                # Copy base video and create new annotations
                copy_video_to_new_location(base_video, video_path)
                generate_annotation_json(num_frames, json_path)
                count += 1

            if depth < max_depth:
                for _ in range(2):  # up to 2 subfolders each
                    subfolder = current_path / fake.word()
                    subfolder.mkdir(parents=True, exist_ok=True)
                    stack.append((subfolder, depth+1))

    click.echo(f"Done! Created {count} videos (all {duration}s long, with annotations).")


if __name__ == '__main__':
    main()
