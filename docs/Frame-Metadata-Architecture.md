# Frame Metadata Architecture

Per-frame metadata is read-only telemetry that describes the media at capture
time, such as timestamp, latitude, longitude, depth, or altitude. DIVE treats it
as a media-side property, not as editable annotation data.

The stored source is the user's `.txt` or `.csv` file next to the imagery.
Everything DIVE serves or displays is a read-time projection of that source.

## Source contract

v1 supports delimited text sidecars for image sequences:

* file extension `.txt` or `.csv`,
* header row,
* comma, tab, or whitespace delimiter,
* at least one column whose values match image filenames,
* at least one payload column beyond the filename column.

The parser keeps payload values as raw strings and preserves source field order.
Filename matching is by value after normalizing the media key, so a reordered or
partial table cannot shift metadata onto the wrong frame. Rows without a filename
match are omitted.

DIVE sniffs candidate text files in the dataset folder. Annotation and other
known DIVE formats are rejected before filename matching, including VIAME CSV.
Bare image lists and unrelated text files are ignored. If more than one distinct
candidate matches, DIVE skips frame metadata instead of guessing.

## Read path

The web backend exposes a windowed endpoint:

```http
GET /dive_dataset/:id/frame_metadata?startFrame=0&endFrame=100
```

`startFrame` and `endFrame` are inclusive, non-negative bounds. The response is
keyed by camera, then frame:

```json
{
  "cameras": {
    "singleCam": {
      "0": {
        "timestamp": "15:40:56",
        "water_depth": "192.80"
      }
    }
  }
}
```

Single-camera datasets use the camera key `singleCam`. Multicamera datasets use
their runtime camera names. A missing or unusable source returns an empty
`cameras` map. Only frames with matching metadata appear in the response.

The desktop backend mirrors the same contract through `loadFrameMetadata`.

## Multicamera routing

For multicamera datasets, DIVE checks text sidecars at the parent folder and in
each child camera folder. Each camera builds its own media filename map and
selects matching rows for that camera.

A shared root file can therefore route one row to multiple cameras through
different filename columns, for example `port_image` and `starboard_image`.
Per-camera child files are also supported. If two distinct records target the
same camera and frame, that frame is omitted rather than resolved by precedence.

## Client behavior

The client keeps a bounded frame window around the playhead. It fetches a new
window only when the active frame leaves the cached range. The Media Metadata
panel reads from this cache and displays the active camera's current-frame values
in source order.

Frame metadata is kept out of annotation, attribute, and dataset metadata stores.
Those stores have edit, save, revision, and export behavior that does not apply
to observed read-only telemetry.

## Non-goals in v1

v1 does not write `frame_metadata.json`, maintain a field registry, import a
telemetry file into annotations, or include frame telemetry in VIAME, DIVE JSON,
COCO, KWCOCO, or zip exports.

Video telemetry, embedded KLV, embedded EXIF, manually selected out-of-folder
sources, charting, training export, and server-side caching for very large
sources are future extensions behind the same read-time contract.
