# Frame Metadata Sidecars

DIVE can display read-only frame metadata for image-sequence datasets in the
[Dataset Info panel](UI-DatasetInfo.md#frame-metadata). Common examples are
timestamp, latitude, longitude, depth, altitude, or vehicle state.

Frame metadata is not annotation data. DIVE reads it from a sidecar file stored
with the dataset when the dataset opens. The values are not edited in DIVE,
imported as annotations, or included in annotation exports.

## Adding Frame Metadata

There are two ways to declare a file as frame metadata:

* **Import button (any filename).** In the annotation viewer, open the Import
  menu and use its **Frame Metadata** section to pick a `.csv` or `.txt` file.
  The file keeps its original name, is stored with the dataset, and appears in
  the Dataset Info panel immediately.
* **Reserved filename.** Name the file `frame-metadata.csv` or
  `frame-metadata.txt` (the snake_case names `frame_metadata.csv` and
  `frame_metadata.txt` are also accepted) and include it with the imagery. The
  name alone identifies the file as frame metadata on every ingestion path:
  dataset uploads, zip archives, assetstore/S3 imports, and desktop folder
  imports.

Use the reserved filename for automated or bulk ingestion and for datasets that
will be exported and re-imported elsewhere — the filename is the only
declaration that travels with the file. Files declared through the Import
button are recorded with the dataset itself, so that declaration does not
survive a dataset export.

Other CSV or text files are handled by the normal annotation import flow.

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

Files added through the Import button are stored with the dataset
automatically; no placement is needed.

For reserved-name sidecars in a single-camera image sequence, place the file in
the dataset folder beside the images.

For a multicamera image sequence, use either:

* one shared sidecar in the multicamera parent folder, or
* one sidecar in each camera folder.

A shared multicamera file can contain one filename column per camera, such as
`port_image` and `starboard_image`. Each active camera displays the rows that
match that camera's images. Files added through the Import button are shared
across cameras the same way.

When both shared and camera-specific sidecars are present, their columns are
combined. For a column both files define, the camera-specific value is used
where available; columns only the shared file defines are filled from the
shared file. In that per-column order, an imported file is used ahead of other
shared sidecars.

## Limits

Frame metadata sidecars are supported for image-sequence datasets. Frame
metadata for videos, embedded KLV, and embedded EXIF are not currently
supported.
