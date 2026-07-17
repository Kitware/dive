# Frame Metadata Sidecars

DIVE can display read-only frame metadata for image-sequence datasets in the
[Dataset Info panel](UI-DatasetInfo.md#frame-metadata). Common examples are
timestamp, latitude, longitude, depth, altitude, or vehicle state.

Frame metadata is not annotation data. DIVE reads it from a sidecar file next to
the imagery when the dataset opens. The values are not edited in DIVE, imported
as annotations, or included in annotation exports.

## Filename

Name the file `frame-metadata.csv` or `frame-metadata.txt`. The snake_case names
`frame_metadata.csv` and `frame_metadata.txt` are also accepted.

The filename identifies the file as frame metadata. Other CSV or text files are
handled by the normal annotation import flow.

## File Format

Use a delimited text file with:

* a header row,
* comma, tab, or whitespace-separated columns,
* at least one column containing image filenames,
* at least one metadata column beyond the filename column.

Rows are matched to frames by filename value, not by row order. Filename
extensions are ignored during matching, so `img_0001.tif` can match an image key
of `img_0001`.

Example:

```text
image_file timestamp latitude longitude water_depth
img_0001.tif 15:40:56 46.575870 -124.603094 192.80
img_0002.tif 15:41:04 46.575912 -124.603080 193.10
```

Values are displayed as strings in the order they appear in the file. DIVE does
not infer units or data types from the column names.

## Placement

For a single-camera image sequence, place the sidecar in the dataset folder
beside the images.

For a multicamera image sequence, use either:

* one shared sidecar in the multicamera parent folder, or
* one sidecar in each camera folder.

A shared multicamera file can contain one filename column per camera, such as
`port_image` and `starboard_image`. Each active camera displays the rows that
match that camera's images.

When both shared and camera-specific sidecars are present, their columns are
combined. For a column both files define, the camera-specific value is used
where available; columns only the shared file defines are filled from the
shared file.

## Limits

Frame metadata sidecars are supported for image-sequence datasets. Frame
metadata for videos, embedded KLV, embedded EXIF, and choosing a sidecar from
another location are not currently supported.
