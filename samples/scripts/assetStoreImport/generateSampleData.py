# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "click",
#     "faker",
# ]
# ///
import csv
import datetime
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
VIDEO_FPS = 30

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

def build_tracks(num_frames: int):
    """Build track dict keyed by string id (DIVE annotation schema)."""
    num_tracks = random.randint(3, 5)
    tracks = {}

    for i in range(num_tracks):
        track_id = i
        shape_type = random.choice(["circle", "rectangle", "diamond", "star"])
        begin = 0
        end = num_frames - 1

        x, y = random.randint(100, FRAME_WIDTH - 100), random.randint(100, FRAME_HEIGHT - 100)
        dx, dy = random.choice([-5, 5]), random.choice([-3, 3])
        base_size = random.randint(40, 80)
        growth_rate = random.uniform(0.05, 0.15)

        features = []
        for frame in range(num_frames):
            x += dx
            y += dy
            if x < 50 or x > FRAME_WIDTH - 50:
                dx *= -1
                x += dx
            if y < 50 or y > FRAME_HEIGHT - 50:
                dy *= -1
                y += dy

            scale = 0.5 * (1 + math.sin(growth_rate * frame))
            size = base_size * (0.75 + 0.5 * scale)

            output_data = generate_geometry(shape_type, x, y, size)
            geom = output_data['geojson']
            coords = output_data['coords']
            bounds = geometry_bounds(coords)

            features.append({
                "frame": frame,
                "bounds": bounds,
                "keyframe": True,
                "geometry": geom,
            })

        tracks[str(track_id)] = {
            "id": track_id,
            "meta": {"shape": shape_type},
            "attributes": {},
            "confidencePairs": [[fake.word(), float(random.randrange(0, 100) / 100)]],
            "begin": begin,
            "end": end,
            "features": features,
        }

    return tracks


def _viame_timestamp(frame: int, fps: int) -> str:
    return datetime.datetime.fromtimestamp(
        frame / fps, datetime.timezone.utc
    ).strftime(r'%H:%M:%S.%f')


def _append_viame_geometry_columns(columns: list, geometry: dict):
    """Append (poly) tokens for polygon geometry (VIAME CSV format)."""
    if not geometry or geometry.get("type") != "FeatureCollection":
        return
    for geo_feature in geometry.get("features", []):
        geom = geo_feature.get("geometry", {})
        if geom.get("type") != "Polygon":
            continue
        coordinates = [
            coord
            for ring in geom.get("coordinates", [])
            for point in ring
            for coord in point
        ]
        columns.append(f"(poly) {' '.join(str(round(c)) for c in coordinates)}")


def generate_annotation_viame_csv(
    tracks: dict,
    output_file: Path,
    *,
    fps: int = VIDEO_FPS,
    frame_filenames: list = None,
):
    """Write tracks as a VIAME CSV annotation file."""
    with open(output_file, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "# 1: Detection or Track-id",
            "2: Video or Image Identifier",
            "3: Unique Frame Identifier",
            "4-7: Img-bbox(TL_x",
            "TL_y",
            "BR_x",
            "BR_y)",
            "8: Detection or Length Confidence",
            "9: Target Length (0 or -1 if invalid)",
            "10-11+: Repeated Species",
            "Confidence Pairs or Attributes",
        ])
        writer.writerow(["# metadata", f"fps: {json.dumps(fps)}"])

        for track in tracks.values():
            confidence_pairs = sorted(
                track["confidencePairs"], key=lambda item: item[1], reverse=True
            )
            for feature in track["features"]:
                columns = [
                    track["id"],
                    "",
                    feature["frame"],
                    *[round(v) for v in feature["bounds"]],
                    confidence_pairs[0][1],
                    -1,
                ]
                if frame_filenames is not None and feature["frame"] < len(frame_filenames):
                    columns[1] = frame_filenames[feature["frame"]]
                elif fps:
                    columns[1] = _viame_timestamp(feature["frame"], fps)

                for pair in confidence_pairs:
                    columns.extend(pair)

                _append_viame_geometry_columns(columns, feature.get("geometry"))
                writer.writerow(columns)


def generate_annotation_json(tracks: dict, output_file: Path):
    """Write tracks as a DIVE track JSON annotation file."""
    annotation = {
        "tracks": tracks,
        "groups": {},
        "version": 2,
    }
    with open(output_file, "w") as f:
        json.dump(annotation, f, indent=2)


def write_annotations(
    num_frames: int,
    output_file: Path,
    *,
    use_viame_csv: bool,
    frame_filenames: list = None,
):
    """Write annotations as either DIVE JSON or VIAME CSV."""
    tracks = build_tracks(num_frames)
    if use_viame_csv:
        generate_annotation_viame_csv(
            tracks, output_file, frame_filenames=frame_filenames
        )
    else:
        generate_annotation_json(tracks, output_file)

def create_video_content(base_dir: Path, max_videos: int, counter: dict, total: int):
    """Create videos and associated JSON or VIAME CSV annotations."""
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

        use_viame_csv = random.choice([True, False])
        ext = ".csv" if use_viame_csv else ".json"
        write_annotations(
            duration * VIDEO_FPS,
            video_path.with_suffix(ext),
            use_viame_csv=use_viame_csv,
        )

def create_image_sequence_content(base_dir: Path, counter: dict, total: int):
    """Create image sequence from a temporary video and generate JSON or VIAME CSV annotations."""
    if counter['count'] >= total:
        return
    duration = random.randint(5, 30)
    tmp_video = base_dir / (fake.word() + "_tmp.mp4")
    create_random_video(tmp_video, duration)
    seq_folder = base_dir / (tmp_video.stem.replace("_tmp", "") + "_frames")
    extract_frames_from_video(tmp_video, seq_folder)
    tmp_video.unlink()
    counter['count'] += 1

    num_frames = duration * VIDEO_FPS
    frame_filenames = [p.name for p in sorted(seq_folder.glob("frame_*.jpg"))]
    use_viame_csv = random.choice([True, False])
    ext = ".csv" if use_viame_csv else ".json"
    annotation_file = seq_folder / (seq_folder.stem + ext)
    write_annotations(
        num_frames,
        annotation_file,
        use_viame_csv=use_viame_csv,
        frame_filenames=frame_filenames if use_viame_csv else None,
    )

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
