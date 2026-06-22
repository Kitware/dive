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

ANNOTATION_FORMATS = ("dive-json", "viame-csv", "coco-json")


def generate_random_dataset_info() -> dict:
    """Random per-dataset metadata for CSV/COCO import testing."""
    return {
        "gfishsite_id": f"{random.randint(2020, 2025)}TXN{random.randint(100, 999):03d}",
        "cruise": random.randint(2300, 2500),
        "year": str(random.randint(2020, 2025)),
        "station": fake.word(),
        "sta_lat": round(random.uniform(24.0, 30.0), 4),
        "sta_lon": round(random.uniform(-98.0, -80.0), 4),
    }


def _random_detection_attributes() -> dict:
    return {
        "visibility": random.choice(["clear", "poor", "partial"]),
        "occluded": random.choice([True, False]),
        "lighting": random.choice(["good", "dim", "backlit"]),
    }


def _random_track_attributes() -> dict:
    return {
        "reviewed": random.choice([True, False]),
        "source": random.choice(["analyst", "model", "import"]),
        "qa_status": random.choice(["pending", "approved", "flagged"]),
    }

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

        track_attributes = _random_track_attributes()
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

            feature = {
                "frame": frame,
                "bounds": bounds,
                "keyframe": True,
                "geometry": geom,
            }
            if random.random() < 0.7:
                feature["attributes"] = _random_detection_attributes()
            features.append(feature)

        tracks[str(track_id)] = {
            "id": track_id,
            "meta": {"shape": shape_type},
            "attributes": track_attributes,
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


def _format_viame_metadata_row(metadata: dict) -> list:
    """Format metadata entries as ``key: <json>`` fields for a VIAME ``# metadata`` row."""
    row = ["# metadata"]
    for key, value in metadata.items():
        row.append(f"{key}: {json.dumps(value)}")
    return row


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
    dataset_info: dict = None,
):
    """Write tracks as a VIAME CSV annotation file."""
    metadata = {
        "fps": fps,
        "exported_by": "dive:generateSampleData",
        "exported_time": datetime.datetime.now().ctime(),
    }
    if dataset_info:
        metadata["dataset_info"] = dataset_info

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
        writer.writerow(_format_viame_metadata_row(metadata))

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


def _feature_to_coco_segmentation(feature: dict) -> list:
    geometry = feature.get("geometry")
    if not geometry or geometry.get("type") != "FeatureCollection":
        return []
    segmentation = []
    for geo_feature in geometry.get("features", []):
        geom = geo_feature.get("geometry", {})
        if geom.get("type") != "Polygon":
            continue
        for ring in geom.get("coordinates", []):
            flat_coords = []
            for x, y in ring:
                flat_coords.extend([x, y])
            if flat_coords:
                segmentation.append(flat_coords)
    return segmentation


def generate_annotation_coco_json(
    tracks: dict,
    output_file: Path,
    *,
    dataset_name: str,
    frame_filenames: list = None,
    dataset_info: dict = None,
):
    """Write tracks as a COCO JSON annotation file (DIVE-compatible extensions)."""
    categories = {}
    coco_annotations = []
    images = {}
    annotation_id = 1

    for track in tracks.values():
        confidence_pairs = sorted(
            track["confidencePairs"], key=lambda item: item[1], reverse=True
        )
        class_name, score = confidence_pairs[0]
        category_id = categories.setdefault(class_name, len(categories) + 1)

        for feature in track["features"]:
            frame = feature["frame"]
            if frame_filenames is not None:
                if frame >= len(frame_filenames):
                    continue
                file_name = frame_filenames[frame]
            else:
                file_name = f"frame_{frame:06d}.jpg"

            x1, y1, x2, y2 = feature["bounds"]
            width = max(0, x2 - x1)
            height = max(0, y2 - y1)
            image_id = frame + 1
            images.setdefault(
                image_id,
                {
                    "id": image_id,
                    "file_name": file_name,
                    "frame_index": frame,
                    "width": FRAME_WIDTH,
                    "height": FRAME_HEIGHT,
                },
            )

            annotation = {
                "id": annotation_id,
                "image_id": image_id,
                "category_id": category_id,
                "bbox": [x1, y1, width, height],
                "area": width * height,
                "iscrowd": 0,
                "score": score,
                "track_id": track["id"],
            }
            if feature.get("attributes"):
                annotation["dive_detection_attributes"] = feature["attributes"]
            if track.get("attributes"):
                annotation["dive_track_attributes"] = track["attributes"]
            segmentation = _feature_to_coco_segmentation(feature)
            if segmentation:
                annotation["segmentation"] = segmentation
            coco_annotations.append(annotation)
            annotation_id += 1

    categories_doc = [
        {"id": category_id, "name": class_name}
        for class_name, category_id in categories.items()
    ]
    info = {
        "description": f"Sample COCO export for {dataset_name}",
        "dive_extensions": [
            "dive_detection_attributes",
            "dive_track_attributes",
        ],
    }
    if dataset_info:
        info["dive_dataset_info"] = dataset_info
        info["dive_extensions"].append("dive_dataset_info")

    coco = {
        "info": info,
        "images": list(images.values()),
        "annotations": coco_annotations,
        "categories": categories_doc,
    }
    with open(output_file, "w") as f:
        json.dump(coco, f, indent=2)


def write_annotations(
    num_frames: int,
    output_file: Path,
    *,
    annotation_format: str,
    frame_filenames: list = None,
    dataset_name: str = "sample-dataset",
):
    """Write annotations as DIVE JSON, VIAME CSV, or COCO JSON."""
    tracks = build_tracks(num_frames)
    dataset_info = generate_random_dataset_info()
    if annotation_format == "viame-csv":
        generate_annotation_viame_csv(
            tracks,
            output_file,
            frame_filenames=frame_filenames,
            dataset_info=dataset_info,
        )
    elif annotation_format == "coco-json":
        generate_annotation_coco_json(
            tracks,
            output_file,
            dataset_name=dataset_name,
            frame_filenames=frame_filenames,
            dataset_info=dataset_info,
        )
    else:
        generate_annotation_json(tracks, output_file)

def _annotation_extension(annotation_format: str) -> str:
    return ".csv" if annotation_format == "viame-csv" else ".json"


def create_video_content(
    base_dir: Path,
    max_videos: int,
    counter: dict,
    total: int,
    annotation_formats: tuple,
):
    """Create videos and associated annotation files."""
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

        annotation_format = random.choice(annotation_formats)
        ext = _annotation_extension(annotation_format)
        write_annotations(
            duration * VIDEO_FPS,
            video_path.with_suffix(ext),
            annotation_format=annotation_format,
            dataset_name=video_path.stem,
        )

def create_image_sequence_content(
    base_dir: Path,
    counter: dict,
    total: int,
    annotation_formats: tuple,
):
    """Create image sequence from a temporary video and generate annotations."""
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
    annotation_format = random.choice(annotation_formats)
    ext = _annotation_extension(annotation_format)
    annotation_file = seq_folder / (seq_folder.stem + ext)
    write_annotations(
        num_frames,
        annotation_file,
        annotation_format=annotation_format,
        frame_filenames=frame_filenames,
        dataset_name=seq_folder.stem,
    )

def create_folder_structure(
    base_dir: Path,
    depth: int,
    max_depth: int,
    max_videos: int,
    counter: dict,
    total: int,
    annotation_formats: tuple,
):
    """Recursively create folders with either videos or image sequences."""
    if counter['count'] >= total:
        return

    content_type = random.choice(["video", "images"])
    if content_type == "video":
        create_video_content(base_dir, max_videos, counter, total, annotation_formats)
    else:
        create_image_sequence_content(base_dir, counter, total, annotation_formats)

    if counter['count'] >= total:
        return

    num_subfolders = random.randint(0, 3)
    for _ in range(num_subfolders):
        if counter['count'] >= total:
            break
        subfolder = base_dir / fake.word()
        subfolder.mkdir(parents=True, exist_ok=True)
        if depth < max_depth:
            create_folder_structure(
                subfolder, depth + 1, max_depth, max_videos, counter, total, annotation_formats
            )
        else:
            leaf_type = random.choice(["video", "images"])
            if leaf_type == "video":
                create_video_content(subfolder, max_videos, counter, total, annotation_formats)
            else:
                create_image_sequence_content(subfolder, counter, total, annotation_formats)

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
@click.option(
    '--annotation-formats',
    default='coco-json,viame-csv',
    show_default=True,
    help=(
        "Comma-separated annotation formats to randomly choose per dataset: "
        "dive-json, viame-csv, coco-json"
    ),
)
def main(output, folders, max_depth, videos, total, annotation_formats):
    base_path = Path(output)
    base_path.mkdir(parents=True, exist_ok=True)

    format_choices = tuple(
        fmt.strip()
        for fmt in annotation_formats.split(',')
        if fmt.strip()
    )
    invalid = [fmt for fmt in format_choices if fmt not in ANNOTATION_FORMATS]
    if invalid:
        raise click.BadParameter(
            f"Unknown annotation format(s): {', '.join(invalid)}. "
            f"Choose from: {', '.join(ANNOTATION_FORMATS)}"
        )
    if not format_choices:
        raise click.BadParameter("At least one annotation format is required.")

    counter = {'count': 0}
    click.echo(
        f"Generating up to {total} datasets in {base_path} "
        f"(formats: {', '.join(format_choices)})..."
    )
    for _ in range(folders):
        if counter['count'] >= total:
            break
        folder_path = base_path / fake.word()
        folder_path.mkdir(parents=True, exist_ok=True)
        create_folder_structure(
            folder_path, 1, max_depth, videos, counter, total, format_choices
        )

    click.echo(f"Done! Created {counter['count']} datasets.")

if __name__ == '__main__':
    main()
