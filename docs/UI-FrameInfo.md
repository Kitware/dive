# Frame Info

The **Frame Info** panel shows read-only per-frame telemetry for the current
image. It is one pane of the
[context sidebar](UI-Navigation-Editing-Bar.md#context-sidebar-web).

Frame telemetry is not an annotation stream. DIVE reads it from a `.txt` or
`.csv` sidecar file next to the imagery and displays the values for the active
frame. The sidecar remains the source of truth; DIVE does not import it into an
editable store or save a derived copy.

## Source file

Use a delimited text file with:

* a header row,
* one or more columns containing image filenames,
* at least one metadata column beyond the filename column.

The delimiter can be comma, tab, or whitespace. DIVE joins rows to frames by
matching filename values, not by row order. A row that does not match an image is
ignored instead of being shifted onto another frame.

Example:

```text
image_file timestamp latitude longitude water_depth
img_0001.tif 15:40:56 46.575870 -124.603094 192.80
img_0002.tif 15:41:04 46.575912 -124.603080 193.10
```

The filename extension is ignored during matching, so `img_0001.tif` matches the
image key `img_0001`. Values are displayed as raw strings in the order they
appear in the source file.

## Placement

For a single-camera image sequence, place the `.txt` or `.csv` file in the
dataset folder beside the images.

For a multicamera image sequence, use either placement:

* Place one shared file at the multicam parent folder. Each camera selects the
  rows or filename column that match its own images.
* Place one file inside each camera child folder. Each file is read only for that
  camera.

A shared multicam file can contain one filename column per camera, such as
`port_image` and `starboard_image`, or one filename column with separate rows for
each camera. The Frame Info panel follows the active camera, so switching cameras
switches the displayed records.

## Display behavior

Open **Frame Info** from the context sidebar while viewing an image-sequence
dataset. The panel updates as the playhead moves.

The panel shows only the source fields for the active frame. It does not repeat
the current frame number or filename, which are already shown by the playback
controls.

The panel may show an empty state when:

* the platform or dataset type does not support frame metadata,
* no matching `.txt` or `.csv` source is present,
* the current frame has no matching row.

Frame telemetry is read-only in v1. There is no edit, save, import, or export
flow for these values. Video telemetry, embedded KLV, embedded EXIF, and manual
selection of a source file from another location are future work.

See [Data Formats](DataFormats.md#per-frame-metadata-text-sidecars) for the
sidecar file contract.
