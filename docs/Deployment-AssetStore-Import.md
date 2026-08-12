# AssetStore Importing and Data Structure

This page describes how to lay out media in an S3-compatible bucket (AWS S3, Google Cloud Storage, or MinIO) so DIVE's **assetstore import** can discover datasets, annotations, and optional frame-metadata sidecars.

For credentials, CORS, mount points, and Girder assetstore setup, see [Cloud Storage Integration](Deployment-Storage.md). This page is the **bucket layout** companion to that guide.

!!! tip

    For a local end-to-end test (generate sample videos/sequences, upload to MinIO, import), see the sample scripts under [`samples/scripts/assetStoreImport/`](https://github.com/Kitware/dive/tree/main/samples/scripts/assetStoreImport).

## What assetstore import does

When you run **Begin Import** on an S3/GCP (or filesystem) assetstore, Girder indexes objects under the destination folder. DIVE hooks that import to:

1. Detect media (video, image sequence, or large image) and mark parent folders as DIVE datasets.
2. Pair annotation files (`.json` / `.csv`) with the correct dataset folder.
3. Pair or discover **frame metadata** attachments (`.json` / `.csv` / `.txt`).
4. After the index finishes, resolve any sidecars that arrived before their video folders, then queue **batch postprocess** (probe via HTTP Range when possible, transcode only if needed, attach annotations/metadata, finalize FPS). For already web-safe H.264 MP4/WebM, convert jobs avoid downloading the full object from the assetstore.

    Remote probes use Girder's `/file/:id/download` endpoint (not `/item/:id/download`) so HTTP Range seeks work — required when an MP4's `moov` atom is at the end of the object. Auth uses a short-lived Girder job token via ffprobe `-/headers` (temp file) on FFmpeg 7.1 workers; job logs also redact any inline `-headers` values.

Self-hosted deployments need the Compose **`localworker`** service running. Postprocess jobs for assetstore import are routed to the `local` queue. See [Running with Docker Compose](Deployment-Docker-Compose.md).


## Supported media layouts

Import recognizes three media kinds from file extensions:

| Kind | Typical extensions | Folder shape after import |
|------|--------------------|---------------------------|
| **Video** | `.mp4`, `.webm`, `.avi`, `.mov`, … | Video is moved into a **child folder** named after the video stem |
| **Image sequence** | `.png`, `.jpg`, `.jpeg`, … | Frames stay in the folder that contains them; that folder becomes the dataset |
| **Large image** | `.tif`, `.tiff`, `.nitf`, … | Same as image sequence (folder becomes the dataset) |

Nested directory trees are fine. Each video or image-sequence folder becomes its own dataset under the mount point.

### Video

Place the video file (and optional siblings) in a parent directory. Import creates a dataset folder named like the video stem and moves the video into it.

```
cruise_a/
  reef.mp4
  reef.csv                 ← annotations (same stem as the video)
  reef_metadata.csv        ← frame metadata (video-paired name; see below)
  lagoon.mp4
  lagoon.json
```

After import, Girder looks roughly like:

```
cruise_a/
  reef/                    ← DIVE video dataset
    reef.mp4
    reef.csv
    frame_metadata.csv     ← renamed/moved from reef_metadata.csv
  lagoon/
    lagoon.mp4
    lagoon.json
```

### Image sequence

Put every frame for one dataset in its own folder. Annotation and reserved-name metadata files sit **inside** that folder (any annotation basename is accepted).

```
cruise_a/
  transect_01/
    frame_0001.jpg
    frame_0002.jpg
    …
    annotations.csv        ← any .csv / .json basename
    frame_metadata.json    ← reserved metadata name
```

## Annotations

Annotation formats are the same as elsewhere in DIVE ([Data Formats](DataFormats.md)): DIVE JSON, VIAME CSV, and COCO/KWCOCO are typical.

| Media | How to name / place annotations |
|-------|----------------------------------|
| **Video** | Same basename as the video, different extension: `reef.mp4` → `reef.csv` or `reef.json`. The sidecar may sit next to the video; import moves it into the video dataset folder. |
| **Image sequence** | Any `.csv` or `.json` file inside the sequence folder. |

!!! note

    VIAME CSV may include a `# metadata` header line with `fps` (and optional `dataset_info`). For videos, import/postprocess can honor that annotation FPS. See [Dataset metadata in the header](DataFormats.md#dataset-metadata-in-the-header).

## Frame metadata attachments

A **frame metadata** file is an opaque sidecar (`.csv`, `.json`, or `.txt`) attached to a dataset. See [Metadata File vs Configuration File](Pipeline-Import-Export.md#metadata-file-vs-configuration-file).

Unlike the web/desktop upload wizards (where you pick the file explicitly), **assetstore import discovers metadata by basename**.

### Reserved names (image sequences)

These basenames declare a frame-metadata attachment. They are **not** imported as annotations:

* `frame_metadata.csv` / `frame_metadata.json` / `frame_metadata.txt`
* `frame-metadata.csv` / `frame-metadata.json` / `frame-metadata.txt`

Put exactly one reserved-name file in the dataset folder (image-sequence folder). Underscore and hyphen forms are equivalent for discovery; import/postprocess prefer the underscore form when renaming.

### Video-paired names (sibling of the video)

Videos often live beside a sidecar. Before import creates the video folder, assetstore import accepts:

```
{videoStem}_metadata.{csv|json|txt}
{videoStem}-metadata.{csv|json|txt}
```

Examples: `reef.mp4` + `reef_metadata.csv`, or `clip_a.mp4` + `clip_a-metadata.txt`.

Import then:

1. Finds the matching **video** dataset folder (`reef/`, typed as video).
2. Renames the item to `frame_metadata.{ext}`.
3. Moves it into that folder and records it as the dataset's metadata attachment.
4. On reimport, replaces any previous reserved-name metadata file in that folder.

If the video folder does not exist yet (import order), the sidecar is deferred and relocated after the index finishes. If the parent is already typed as an image sequence (or another non-video layout) and there is no matching video folder, a `{stem}_metadata.csv` / `.json` name is **not** treated as frame metadata — it can follow the normal annotation pairing rules instead. A `.txt` that is neither a reserved name nor a successful video-paired relocate is ignored for annotations.

!!! info

    Wizard uploads on web/desktop do **not** auto-discover `{stem}_metadata` siblings. That pairing is specific to assetstore (and filesystem) import. Reserved `frame_metadata` / `frame-metadata` names are shared with other importers for in-folder discovery.

## After import

1. Check Girder **Jobs** until import and postprocess jobs complete.
2. In the DIVE UI, open datasets under your mount-point collection/folder.
3. Confirm annotations loaded and, if expected, that a metadata file is attached on the dataset.

FPS defaults:

* Videos without a VIAME CSV FPS override use the media FPS.
* Image sequences default to 1 FPS unless metadata/annotations set otherwise.

## Checklist

* One dataset per video file or per image-sequence folder
* Video annotations share the video stem (`video.mp4` ↔ `video.csv`)
* Image-sequence annotations live in the same folder as the frames
* At most one frame-metadata file per dataset
* Videos: use `{stem}_metadata.{ext}` beside the video, **or** `frame_metadata.{ext}` inside the video folder after layout
* Image sequences: use a reserved `frame_metadata` / `frame-metadata` basename inside the folder
* `localworker` is running on self-hosted Compose deployments
