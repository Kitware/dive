# Frame Metadata Architecture

Per-frame metadata is read-only telemetry that describes the media at capture
time, such as timestamp, latitude, longitude, depth, or altitude. DIVE treats it
as a media-side property, not as editable annotation data.

The stored source is the user's `.meta.csv` or `.meta.txt` file next to the
imagery. Everything DIVE serves or displays is a read-time projection of that
source.

Read-time discovery is authoritative for supported datasets. DIVE finds
sidecars by scanning the dataset folders when the panel asks for metadata, not
by importing them into a separate store. Import never deletes a sidecar and
never silently swallows one: a telemetry file uploaded alongside media stays in
the dataset folder. For image-sequence datasets it is picked up by the read
path; for unsupported dataset types it is retained with a warning that Dataset
Info does not display it yet.

**The invariant:** a file is telemetry if and only if its name says `.meta.`
(`.meta.csv` or `.meta.txt`, case-insensitive). Import never parses, deletes, or
reroutes a declared sidecar; non-sidecar files behave exactly as on `main`; and
telemetry that fails to join to any frame warns loudly instead of failing
silently. Classification is by declaration, never by content sniffing.

## Import behavior

A declared sidecar rides along with the imagery: web upload validation accepts
it as a media-folder file, and the assetstore importer leaves it in place
instead of relocating it as an annotation. On upload, DIVE parses a newly added
sidecar once, warn-only, so a file whose filename column matches none of the
dataset's images surfaces a warning (`… matched none of this dataset's image
filenames; the Dataset Info panel will not show it.`) at import time rather than
appearing as an empty panel later. This check never fails the import and never
removes the file. Video and large-image uploads may carry declared sidecars too;
DIVE stores those files in the dataset folder, but warns that Dataset Info
currently displays frame metadata only for image-sequence datasets.

Two guards keep telemetry and annotations from being confused:

* **Rename hint (web):** when an annotation CSV import fails to parse, the error
  message appends `If this file is telemetry rather than annotations, rename it
  to end in .meta.csv and re-upload.` so a misfiled nav CSV is easy to correct.
* **Explicit-import guard (desktop):** importing a `.meta.csv`/`.meta.txt` file
  through the annotation import flow throws — the file must live in the dataset's
  media folder, where it is read automatically, and cannot be imported as
  annotations.

## Source contract

v1 supports delimited text sidecars for image sequences:

* a name ending in `.meta.csv` or `.meta.txt` (case-insensitive),
* header row,
* comma, tab, or whitespace delimiter,
* at least one column whose values match image filenames,
* at least one payload column beyond the filename column.

The parser keeps payload values as raw strings and preserves source field order.
Filename matching is by value after normalizing the media key, so a reordered or
partial table cannot shift metadata onto the wrong frame. Rows without a filename
match are omitted.

DIVE discovers candidate sidecars in the dataset folder by name: a file is
telemetry if and only if its name ends in `.meta.csv` or `.meta.txt`. There is
no content sniffing, so a declared sidecar is never confused with a VIAME CSV or
other DIVE format, and an annotation CSV is never mistaken for telemetry. A
declared sidecar is never size-gated: a large file costs one parse, which is
cached (see "Parse cache"), and declared telemetry is never silently dropped.
When more than one candidate matches, DIVE uses all of them and merges by
first-wins precedence (see "Candidate precedence and merge") rather than
skipping.

## Candidate precedence and merge

A camera can match several sidecars. DIVE gathers candidates in a fixed order:

1. dataset/camera-local folder candidates, filename-sorted case-insensitively;
2. then parent/root folder candidates (multicamera parent, clone media root),
   filename-sorted case-insensitively.

Candidates are parsed in that order, and one that does not parse as telemetry is
skipped. Merge is first-wins at every level: the first source to claim a frame
wins, and within a single file the first row to claim an image wins. There is no
value comparison, no conflict detection, and no omitted frames.

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
  },
  "sources": {
    "singleCam": ["AUV_telemetry.meta.csv"]
  }
}
```

Single-camera datasets use the camera key `singleCam`. Multicamera datasets use
their runtime camera names. A missing or unusable source returns an empty
`cameras` map. Only frames with matching metadata appear in the response.

`sources` lists the filenames of every sidecar that matched each camera, in
precedence order (winner first). It is computed from the full parse, not the
requested frame window, so it is identical across window fetches. The key is
present only when at least one source matched; the client treats it as optional.

The desktop backend mirrors the same contract through `loadFrameMetadata`.

## Parse cache

Each sidecar is parsed once per (file version, media-name set) and the result is
held in a bounded in-process LRU of 32 entries shared across window requests.
Within a single load a candidate file's text is downloaded or read at most once;
across requests a cached parse serves every window, sliced per request from the
parsed result. An entry is keyed by file identity (a Girder file id and size on
the server; absolute path, mtime, and size on desktop) plus a fingerprint of the
camera's media-name set, so replacing the sidecar file or changing the dataset's
media invalidates it automatically. The cache is per-worker: on a multi-worker
deployment each worker parses a given source once.

## Multicamera routing

For multicamera datasets, DIVE checks text sidecars at the parent folder and in
each child camera folder. Each camera builds its own media filename map and
selects matching rows for that camera.

A shared root file can therefore route one row to multiple cameras through
different filename columns, for example `port_image` and `starboard_image`.
Per-camera child files are also supported, and they take precedence over the
shared parent file: a camera's own folder candidates are merged before the
parent and clone-root candidates, so a camera-local value wins over a parent
value for the same frame (first-wins).

## Client behavior

The client keeps a bounded frame window around the playhead. It fetches a new
window only when the active frame leaves the cached range. The Dataset Info
panel reads from this cache and displays the active camera's current-frame values
in source order.

Frame metadata is kept out of annotation, attribute, and dataset metadata stores.
Those stores have edit, save, revision, and export behavior that does not apply
to observed read-only telemetry.

## Known limitations

Telemetry columns whose names are all digits may display in numeric order rather
than the source's column order. JavaScript objects enumerate integer-like keys
first in ascending numeric order, and that ordering is lost in the backend, in
`JSON.parse` on the web, and in structured clone over IPC, so no client-side fix
can recover it. Carrying explicit column order on the wire is future work tied to
the charts item, which needs a response-shape change anyway.

## Non-goals in v1

v1 does not write `frame_metadata.json`, maintain a field registry, import a
telemetry file into annotations, or include frame telemetry in VIAME, DIVE JSON,
COCO, KWCOCO, or zip exports.

Video telemetry, embedded KLV, embedded EXIF, manually selected out-of-folder
sources, charting, and training export are future extensions behind the same
read-time contract.
