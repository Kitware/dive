# Frame Metadata Sidecars

DIVE can display read-only frame metadata for image-sequence and video datasets in the
[Dataset Info panel](UI-DatasetInfo.md#frame-metadata). Common examples include
timestamp, latitude, longitude, depth, altitude, and vehicle state.

Frame metadata is not annotation data. DIVE derives it from a selected metadata
attachment when the dataset opens. The values are not edited in DIVE, imported
as annotations, or included in annotation exports.

## Adding Frame Metadata

Choose one metadata attachment when creating a dataset. A single-camera dataset
has one attachment. A multicamera dataset may have one shared attachment and one
attachment for each camera.

TXT and CSV attachments are read for frame metadata values. JSON, TXT, and CSV
attachments remain independent pipeline inputs: a file with no matching rows is
still passed unchanged to a pipeline that requests it.

For automated, archive, assetstore, or desktop-folder ingestion, use one of the
reserved names:

* `frame-metadata.csv`
* `frame-metadata.json`
* `frame-metadata.txt`
* `frame_metadata.csv`
* `frame_metadata.json`
* `frame_metadata.txt`

The reserved name identifies the attachment on ingestion paths where an upload
field is not available. Other filenames may be selected explicitly in a
creation-time metadata field.

A reserved name is matched on the basename alone, ignoring case. The two JSON
names are reserved so a file named for frame metadata is never imported as DIVE
annotation JSON; like any JSON attachment it is passed to opt-in pipelines and
is not read for frame metadata values.

When both a shared attachment and a camera-local attachment exist, the local
attachment replaces the shared attachment for that camera. DIVE does not merge
the files by column, row, or frame.

## File Format

Use a table with a header row and comma, tab, or whitespace-separated values.
Values remain strings and columns appear in source order.

For image sequences, DIVE joins rows to the current camera's ordered images by
value, in this order:

1. filename;
2. literal `frame`, containing a DIVE frame number;
3. source image counter.

There is no row-order fallback. Rows may be sparse or out of order.

For videos, only the literal `frame` join is available. Video filenames,
source counters, and other integer columns are not frame identity.

### Filename Values

A cell matches when its extension-stripped basename equals an image's
extension-stripped basename. For example, `images/img_0001.tif` can match
`img_0001`.

A sidecar may contain one filename column per camera. DIVE resolves the same
shared file independently for each camera. If duplicate source rows name the
same image, the first row wins.

The leftmost column that names at least two of a camera's images is the join
column; every other column is treated as data. A sibling camera's filename
column names none of this camera's images, so it is never chosen. If a single
dataset holds more than one camera's media, order the table so the intended
column comes first, or use the literal `frame` contract.

Filename matching has highest priority. This preserves interchange tables that
contain both an image filename and a `frame` field with a different meaning.

```text
image_file latitude longitude depth_m
img_0001.tif 46.575870 -124.603094 192.80
img_0002.tif 46.575912 -124.603080 193.10
```

### Literal `frame`

The exact lowercase, case-sensitive header `frame` declares zero-based DIVE
frame numbers. `Frame`, `frame_index`, and `frame_id` are not aliases.

Values must be non-negative base-10 integers in JavaScript's safe-integer range.
Leading zeros are accepted. A value must be within the current camera's usable
DIVE frame range. For an image sequence, that range is determined by its
ordered images. For a video, it is determined by the annotation/display frames
exposed at the dataset's effective FPS. A video `frame` value does not identify
an encoded container frame or packet. The `frame` column remains visible in
the panel, and the file must contain at least one other column.

Invalid and out-of-range rows are skipped. For duplicate valid values, the
first row wins. One valid row produces a sparse result, but a declared `frame`
column with no valid in-range rows is unmatched and does not fall through to a
source-counter join. Rename a source column such as `frame` to `source_frame`
when it is not a DIVE frame number.

```text
frame,timestamp,depth_m
3,2024-06-01T12:30:15Z,106.2
0,2024-06-01T12:30:00Z,102.5
```

### Source Image Counters

For numbered imagery, DIVE can match a non-negative integer column to the
trailing digit run of each image filename stem. For example, `173` can match
`camera_00173.jpg`. Column names are not used as evidence; `frame_count` is a
conventional name, not a required one.

Counter matching is deliberately strict:

* a counter repeated by multiple media files is excluded;
* a matching counter repeated in the attachment disqualifies that column;
* matched DIVE frames must be strictly increasing or strictly decreasing in
  source-row order, although gaps are allowed.

The leftmost integer column passing every check is used. These checks prevent
constants, reset counters, and unrelated numeric fields from silently selecting
rows. If a source log reuses counters after a reset, slice it to one monotonic
segment or use the literal `frame` contract.

## Placement and Multicamera Selection

For a single-camera image sequence or video, place a reserved-name attachment
beside the media or select it during dataset creation.

For a multicamera image-sequence or video dataset, place a shared reserved-name
attachment in the multicamera parent folder, or put a camera-local attachment
in a camera folder. Shared attachments are resolved separately against each
camera's media and usable frame range. A camera-local attachment replaces the
shared attachment for that camera; the two are never merged.

Multicamera video follows DIVE's positional playback contract: global frame
`N` selects local DIVE frame `N` in every camera where that frame exists.
Frame metadata does not infer camera start offsets or correct dropped frames,
clock drift, or capture-time differences.

## Export and Re-import

A full dataset export carries the attachment inside the archive: the dataset's
own attachment at `metadata/<name>`, and each camera's attachment at
`<camera>/metadata/<name>`. Importing that archive restores it, on the web
version and on DIVE Desktop alike, so an export/import round-trip keeps the
attachment the panel displays.

The archive layout is the whole contract — nothing in `meta.json` names the
attachment. An archive from an older DIVE that stored the file elsewhere imports
normally; its attachment arrives as an ordinary dataset file, and it is picked up
automatically only if it carries a reserved name.

## Passing the Attachment to a Pipeline

A pipeline opts in to the selected attachment with a KWIVER configuration key
in its header:

```text
# Metadata File: stabilizer:flight_log
```

When the pipeline runs, DIVE passes the exact attachment as
`-s stabilizer:flight_log=<path>`. This is independent of frame metadata parsing.
JSON attachments and unmatched TXT or CSV attachments therefore remain useful
pipeline inputs.

## Limits

Timestamp or other temporal alignment, embedded KLV, embedded EXIF, and changing
an attachment after dataset creation are not currently supported. Resolved rows
are read-only derived state; the selected attachment remains independently
available to pipelines that opt in to it.

An attachment can be stored on a dataset of any media type and passed to opt-in
pipelines from any of them. Frame metadata values are resolved and displayed for
image-sequence, large-image, and video datasets. Large image joins on filenames
exactly as an image sequence does.
