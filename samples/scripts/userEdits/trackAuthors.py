# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "click",
#     "pymongo",
# ]
# ///
"""
List the trackItem versions of a DIVE dataset with who saved each one.

Each saved version of a track is a document in the trackItem collection whose
rev_created points at a revisionLogItem entry (author, time, description).
For image-sequence datasets the frame numbers are mapped to image names using
the same ordering the server uses (server/dive_server/crud.py valid_images).

Run with uv:
  uv run samples/scripts/userEdits/trackAuthors.py <folderId>
  uv run samples/scripts/userEdits/trackAuthors.py <folderId> --container dive-mongo-1
  uv run samples/scripts/userEdits/trackAuthors.py <folderId> --all-versions --features --revisions
  uv run samples/scripts/userEdits/trackAuthors.py <folderId> --mongo-uri mongodb://localhost:27017/girder -o out.json
"""

from __future__ import annotations

import functools
import itertools
import json
import re
import subprocess
from typing import Any, Dict, List, Optional, Union

import click
from bson import ObjectId
from pymongo import MongoClient
from pymongo.errors import ServerSelectionTimeoutError

# dive_utils/constants.py
WEB_VALID_IMAGE_FORMATS = ("png", "jpg", "jpeg")
SAFE_IMAGE_REGEX = r"(\." + r"|\.".join(WEB_VALID_IMAGE_FORMATS) + r")$"
IMAGE_SEQUENCE_TYPE = "image-sequence"
FOREIGN_MEDIA_ID_MARKER = "foreign_media_id"
NUMBERS_REGEX = re.compile(r"(\d+)")


def _maybe_int(value: str) -> Union[str, int]:
    try:
        return int(value)
    except ValueError:
        return value


def _str_chunks(value: str) -> List[Union[int, str]]:
    return [_maybe_int(v) for v in NUMBERS_REGEX.split(value) if v != ""]


def str_numeric_compare(input1: str, input2: str) -> int:
    """Mirror of dive_utils.strNumericCompare so frame order matches the server."""
    if input1 == input2:
        return 0
    for a, b in itertools.zip_longest(_str_chunks(input1), _str_chunks(input2), fillvalue=None):
        if a == b:
            continue
        if a is None:
            return -1
        if b is None:
            return 1
        if type(a) == int and type(b) == int:
            return a - b
        if type(a) == int:
            return -1
        if type(b) == int:
            return 1
        return 1 if str(a) > str(b) else -1
    return 0


def get_clone_root(db, folder: Dict[str, Any]) -> Dict[str, Any]:
    """Follow foreign_media_id so clones resolve to the folder holding the media."""
    next_id = folder.get(FOREIGN_MEDIA_ID_MARKER)
    while next_id:
        source = db.folder.find_one({"_id": ObjectId(str(next_id))})
        if source is None:
            raise click.ClickException(f"Clone source folder {next_id} no longer exists")
        folder = source
        next_id = folder.get(FOREIGN_MEDIA_ID_MARKER)
    return folder


def image_names(db, folder: Dict[str, Any]) -> List[str]:
    media_folder = get_clone_root(db, folder)
    items = db.item.find(
        {"folderId": media_folder["_id"], "lowerName": {"$regex": SAFE_IMAGE_REGEX}},
        {"name": 1},
    )
    names = [item["name"] for item in items]
    return sorted(names, key=functools.cmp_to_key(str_numeric_compare))


def container_ip(container: str) -> str:
    try:
        result = subprocess.run(
            [
                "docker",
                "inspect",
                "-f",
                "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}",
                container,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as err:
        stderr = getattr(err, "stderr", "") or str(err)
        raise click.ClickException(f"Could not inspect container {container}: {stderr.strip()}")
    ips = result.stdout.split()
    if not ips:
        raise click.ClickException(f"Container {container} has no network IP (is it running?)")
    return ips[0]


def frame_name(images: Optional[List[str]], frame: int) -> Optional[str]:
    if images is None or frame < 0 or frame >= len(images):
        return None
    return images[frame]


@click.command(name="trackAuthors", help="List trackItem versions and their authors for a dataset")
@click.argument("folder_id")
@click.option(
    "--mongo-uri",
    default="mongodb://localhost:27017/girder",
    show_default=True,
    help="Girder MongoDB URI (database name taken from the path)",
)
@click.option(
    "--container",
    default=None,
    help="Docker container running Mongo (e.g. dive-mongo-1); its IP overrides --mongo-uri",
)
@click.option(
    "--all-versions",
    is_flag=True,
    help="Include replaced and deleted versions (default: only the current version of each track)",
)
@click.option(
    "--revisions", "include_revisions", is_flag=True, help="Include the dataset's full revision log"
)
@click.option("--features", is_flag=True, help="Include every feature frame (and image name)")
@click.option("--set", "annotation_set", default=None, help="Annotation set name (default set if omitted)")
@click.option("-o", "--output", type=click.Path(dir_okay=False), help="Write JSON here instead of stdout")
def main(folder_id, mongo_uri, container, all_versions, include_revisions, features, annotation_set, output):
    if container:
        mongo_uri = f"mongodb://{container_ip(container)}:27017/girder"
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except ServerSelectionTimeoutError:
        raise click.ClickException(
            f"Could not reach MongoDB at {mongo_uri}. The default docker-compose does not publish "
            "port 27017; try --container dive-mongo-1 or pass --mongo-uri with the container IP."
        )
    db = client.get_default_database()
    dataset_id = ObjectId(folder_id)

    folder = db.folder.find_one({"_id": dataset_id})
    if folder is None:
        raise click.ClickException(f"Folder {folder_id} not found")
    dataset_type = folder.get("meta", {}).get("type")
    images = image_names(db, folder) if dataset_type == IMAGE_SEQUENCE_TYPE else None

    # Revision numbers are unique per dataset across all sets; the default set is stored as None
    track_query: Dict[str, Any] = {"dataset": dataset_id, "set": annotation_set or None}
    if not all_versions:
        track_query["rev_deleted"] = {"$exists": False}

    revisions = {r["revision"]: r for r in db.revisionLogItem.find({"dataset": dataset_id})}
    if annotation_set:
        revisions = {k: r for k, r in revisions.items() if r.get("set") == annotation_set}
    else:
        revisions = {k: r for k, r in revisions.items() if not r.get("set")}

    tracks = []
    for track in db.trackItem.find(track_query).sort([("id", 1), ("rev_created", 1)]):
        rev = revisions.get(track.get("rev_created"), {})
        entry = {
            "trackId": track["id"],
            "begin": track.get("begin"),
            "end": track.get("end"),
            "beginImage": frame_name(images, track.get("begin", -1)),
            "endImage": frame_name(images, track.get("end", -1)),
            "featureCount": len(track.get("features", [])),
            "types": [pair[0] for pair in track.get("confidencePairs", [])],
            "rev_created": track.get("rev_created"),
            "rev_deleted": track.get("rev_deleted"),
            "author": rev.get("author_name"),
            "authorId": str(rev["author_id"]) if rev.get("author_id") else None,
            "saved": rev["created"].isoformat() if rev.get("created") else None,
            # "save" is a manual edit in the UI, "Import ..." is a file or pipeline import
            "description": rev.get("description"),
        }
        if features:
            entry["features"] = [
                {
                    "frame": f["frame"],
                    "image": frame_name(images, f["frame"]),
                    "keyframe": f.get("keyframe"),
                    "interpolate": f.get("interpolate"),
                }
                for f in track.get("features", [])
            ]
        tracks.append(entry)

    result = {
        "datasetId": folder_id,
        "name": folder.get("name"),
        "type": dataset_type,
        "imageCount": len(images) if images is not None else None,
        "tracks": tracks,
    }
    if include_revisions:
        result["revisions"] = [
            {
                "revision": r["revision"],
                "author": r.get("author_name"),
                "saved": r["created"].isoformat() if r.get("created") else None,
                "description": r.get("description"),
                "additions": r.get("additions"),
                "deletions": r.get("deletions"),
            }
            for r in sorted(revisions.values(), key=lambda r: r["revision"])
        ]

    text = json.dumps(result, indent=2)
    if output:
        with open(output, "w") as f:
            f.write(text)
        click.echo(f"Wrote {len(tracks)} track versions to {output}", err=True)
    else:
        click.echo(text)


if __name__ == "__main__":
    main()
