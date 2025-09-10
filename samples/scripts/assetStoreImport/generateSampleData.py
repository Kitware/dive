# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "click",
#     "faker",
# ]
# ///
import random
import subprocess
import json
from pathlib import Path
import click
from faker import Faker
import math

fake = Faker()

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720

def create_random_video(file_path: Path, duration: int):
    """Create a random test video using ffmpeg (MP4 container, H.264 codec)."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30",
        "-t", str(duration),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        str(file_path)
    ]
    subprocess.run(cmd, check=True)

def extract_frames_from_video(video_path: Path, image_dir: Path):
    """Extract frames from a video and save as sequential JPG files."""
    image_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        str(image_dir / "frame_%04d.jpg")
    ]
    subprocess.run(cmd, check=True)

def generate_star_points(cx, cy, r, spikes=5):
    """Generate points for a star polygon."""
    pts = []
    angle = math.pi / spikes
    for i in range(2 * spikes):
        radius = r if i % 2 == 0 else r / 2
        x = cx + math.cos(i * angle) * radius
        y = cy + math.sin(i * angle) * radius
        pts.append([x, y])
    pts.append(pts[0])  # close polygon
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
    for i in range(segments+1):
        angle = 2 * math.pi * i / segments
        x = cx + math.cos(angle) * r
        y = cy + math.sin(angle) * r
        pts.append([x, y])
    return pts

def generate_geometry(shape: str, cx: float, cy: float, size: float):
    """Return GeoJSON polygon of the shape centered at (cx, cy)."""
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
                "type" :"Feature",
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
    """Calculate bounding box [x1, y1, x2, y2] from polygon points."""
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

        # Initial position and motion
        x, y = random.randint(100, FRAME_WIDTH-100), random.randint(100, FRAME_HEIGHT-100)
        dx, dy = random.choice([-5, 5]), random.choice([-3, 3])
        base_size = random.randint(40, 80)
        growth_rate = random.uniform(0.05, 0.15)

        features = []
        for frame in range(num_frames):
            # Update position and bounce
            x += dx
            y += dy
            if x < 50 or x > FRAME_WIDTH-50:
                dx *= -1
                x += dx
            if y < 50 or y > FRAME_HEIGHT-50:
                dy *= -1
                y += dy

            # Smooth scaling
            scale = 0.5 * (1 + math.sin(growth_rate * frame))
            size = base_size * (0.75 + 0.5 * scale)

            # Create moving geometry
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

def create_video_content(base_dir: Path, max_videos: int, counter: dict, total: int):
    """Create videos and associated JSON annotations."""
    if counter['count'] >= total:
        return
    num_videos = random.randint(1, max_videos)
    for _ in range(num_videos):
        if counter['count'] >= total:
            break
        duration = random.randint(5, 30)
        name = fake.word() + ".mp4"
        video_path = base_dir / name
        create_random_video(video_path, duration)
        counter['count'] += 1

        # Generate annotation JSON
        generate_annotation_json(duration * 30, video_path.with_suffix(".json"))

def create_image_sequence_content(base_dir: Path, counter: dict, total: int):
    """Create image sequence from a temporary video and generate JSON annotations."""
    if counter['count'] >= total:
        return
    duration = random.randint(5, 30)
    tmp_video = base_dir / (fake.word() + "_tmp.mp4")
    create_random_video(tmp_video, duration)
    seq_folder = base_dir / (tmp_video.stem.replace("_tmp", "") + "_frames")
    extract_frames_from_video(tmp_video, seq_folder)
    tmp_video.unlink()
    counter['count'] += 1

    # Generate annotation JSON for image sequence folder
    annotation_file = seq_folder / (seq_folder.stem + ".json")
    generate_annotation_json(duration * 30, annotation_file)

def create_folder_structure(base_dir: Path, depth: int, max_depth: int,
                            max_videos: int, counter: dict, total: int):
    """Recursively create folders with either videos or image sequences."""
    if counter['count'] >= total:
        return

    content_type = random.choice(["video", "images"])
    if content_type == "video":
        create_video_content(base_dir, max_videos, counter, total)
    else:
        create_image_sequence_content(base_dir, counter, total)

    if counter['count'] >= total:
        return

    num_subfolders = random.randint(0, 3)
    for _ in range(num_subfolders):
        if counter['count'] >= total:
            break
        subfolder = base_dir / fake.word()
        subfolder.mkdir(parents=True, exist_ok=True)
        if depth < max_depth:
            create_folder_structure(subfolder, depth+1, max_depth, max_videos, counter, total)
        else:
            leaf_type = random.choice(["video", "images"])
            if leaf_type == "video":
                create_video_content(subfolder, max_videos, counter, total)
            else:
                create_image_sequence_content(subfolder, counter, total)

@click.command()
@click.option('--output', '-o', default='./sample', show_default=True,
              type=click.Path(file_okay=False), help="Base output directory")
@click.option('--folders', '-f', default=3, show_default=True,
              help="Number of top-level folders to create")
@click.option('--max-depth', '-d', default=2, show_default=True,
              help="Maximum subfolder depth")
@click.option('--videos', '-v', default=2, show_default=True,
              help="Maximum videos per folder")
@click.option('--total', '-t', default=10, show_default=True,
              help="Total number of datasets (videos or image sequences)")
def main(output, folders, max_depth, videos, total):
    base_path = Path(output)
    base_path.mkdir(parents=True, exist_ok=True)

    counter = {'count': 0}
    click.echo(f"Generating up to {total} datasets in {base_path}...")
    for _ in range(folders):
        if counter['count'] >= total:
            break
        folder_path = base_path / fake.word()
        folder_path.mkdir(parents=True, exist_ok=True)
        create_folder_structure(folder_path, 1, max_depth, videos, counter, total)

    click.echo(f"Done! Created {counter['count']} datasets.")

if __name__ == '__main__':
    main()
