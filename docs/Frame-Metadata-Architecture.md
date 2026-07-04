# Frame Metadata Architecture

Per-frame metadata is read-only telemetry that describes the media at capture
time, such as timestamp, latitude, longitude, depth, or altitude. DIVE treats it
as a media-side property, not as editable annotation data.

The stored source is the user's `.meta.csv` or `.meta.txt` file next to the
imagery. Everything DIVE displays is a read-time projection of that source:
nothing derived is persisted, and the file the user dropped is the only stored
form.

**The invariant:** a file is telemetry if and only if its name says `.meta.`
(`.meta.csv` or `.meta.txt`, case-insensitive). Import never parses, deletes, or
reroutes a declared sidecar; non-sidecar files behave exactly as on `main`.
Classification is by declaration, never by content sniffing — the naming
convention is the one flag that travels all of DIVE's ingestion paths.

## One parser, one resolver

There is exactly one implementation of the telemetry format, and it is
TypeScript. It lives in `client/dive-common/frameMetadata/` and is shared by both
platforms:

* **`naming.ts`** — `isFrameMetadataSourceName(name)`, the `.meta.(csv|txt)`
  predicate.
* **`parser.ts`** — `parseFrameMetadataSource(text, mediaIndex)`, which turns one
  sidecar's raw text into columns plus filename-keyed records.
* **`resolve.ts`** — `buildMediaKeyIndex(mediaNames)` and
  `resolveCameras(candidateTexts, mediaKeys)`, which join a camera's candidate
  sidecars to its media list and merge them into the compact per-camera payload
  the Frame Info panel renders.

The parser and resolver never run on the server. Division of labor:

| Component | Responsibility |
| --- | --- |
| **Shared TypeScript** (`dive-common/frameMetadata/`) | The naming predicate, the parser, and the resolver. One implementation; the conformance corpus (`testdata/frame-metadata-conformance`) is its regression suite. |
| **Web** | The browser asks the server which sidecar items exist per camera (the sources endpoint, below), downloads their bytes over the existing item-download route, builds each camera's media-key index from the image lists the viewer already holds, and runs the shared resolver **in the renderer**. |
| **Desktop** | The Electron backend discovers candidate files on disk (name-filtered), reads them, runs the **same** shared resolver in the backend — keeping raw multi-MB text off the IPC wire — and returns the resolved payload over the existing IPC surface. |
| **Python server** | Never parses telemetry. It classifies by name (imports leave sidecars in place), lets sidecars through upload validation, and serves the sources listing. That is all. |

The only logic mirrored across the platform boundary is the naming predicate: the
TypeScript `isFrameMetadataSourceName` and the Python
`dive_utils.frame_metadata.is_frame_metadata_source_name` are pinned together by a
shared accepted/rejected name list
(`testdata/frame-metadata-conformance/source_names.expected.json`) asserted in
both a TS spec and a Python test. No parsing logic is duplicated in Python.

## Import behavior

A declared sidecar rides along with the imagery and is never treated as
annotations:

* **Web upload.** Upload validation buckets the sidecar under a
  `frameMetadata` role, shows it pre-upload as "frame metadata: `nav.meta.csv`",
  and uploads it into the dataset folder alongside the media. It is excluded from
  the single-annotation-CSV cap.
* **Assetstore import.** The importer leaves a declared sidecar in place instead
  of relocating it as an annotation; no `ProcessedMarker`, no move.
* **Server import sweep.** When a sidecar is encountered, DIVE emits a warning
  line ("stored as frame metadata, not annotations"), sets a `ProcessedMarker`,
  and leaves the item in the dataset folder.
* **Unsupported media types.** Video and large-image datasets can carry a
  declared sidecar too. It is reported pre-upload in the `ignored` bucket with the
  reason "frame metadata is not supported for this media type", stored in the
  folder, and not shown in Dataset Info (which reads frame metadata only for
  image-sequence datasets).

### No import-time join warn-check

The readtime design parsed a newly uploaded sidecar once at import time to warn
when its filename column matched none of the dataset's images. **This design has
no such check.** The server never parses telemetry, so it cannot compute a
filename join and cannot warn about one. Attempting to move the check to the
client would mean re-parsing on the server or shipping a second parser — neither
is acceptable under "one parser."

The discoverability surface is therefore two other things, and this is why the
web upload packaging refactor is a prerequisite rather than a follow-up:

1. **Pre-upload role display** (from the packaging refactor). Before anything is
   sent, the upload UI names each selected file's role — "frame metadata:
   `nav.meta.csv`" — or lists it as ignored with a reason. A sidecar the user
   expected to be annotations, or an annotation CSV they expected to be
   telemetry, is visible before upload. Crucially, the refactor closes the one
   silent-loss path (a browser dropping a sidecar before upload), which nothing
   downstream could otherwise detect.
2. **The Frame Info panel's empty state and `Source:` line.** After open, the
   panel names the sidecar it read (`Source: nav.meta.csv`) and, when nothing
   matched, shows an empty-state hint pointing at the naming convention. A sidecar
   whose filenames match no frame surfaces as an empty panel with a hint, not a
   silent nothing.

Two guards keep telemetry and annotations from being confused:

* **Rename hint (web/desktop).** When an annotation CSV fails to parse, the error
  appends `If this file is telemetry rather than annotations, rename it to end in
  .meta.csv and re-upload.` so a misfiled nav CSV is easy to correct.
* **Explicit-import guard (desktop).** Importing a `.meta.csv`/`.meta.txt` file
  through the annotation import flow throws — the file must live in the dataset's
  media folder, where it is read automatically, and cannot be imported as
  annotations.

## Source contract

v1 supports delimited text sidecars for image sequences:

* a name ending in `.meta.csv` or `.meta.txt` (case-insensitive),
* a header row,
* a comma, tab, or whitespace delimiter (sniffed from the first non-comment line),
* at least one column whose values match image filenames (the join column, chosen
  by best match against the media keys),
* at least one payload column beyond the join column.

The parser keeps payload values as raw strings and preserves source field order.
Filename matching is by value after normalizing the media key (directory prefix
and one image extension stripped), so `img_0001.tif` matches an image key of
`img_0001`, and a reordered or partial table cannot shift metadata onto the wrong
frame. Rows without a filename match are omitted.

Discovery is by name only: there is no content sniffing, so a declared sidecar is
never confused with a VIAME CSV or other DIVE format, and an annotation CSV is
never mistaken for telemetry. **A declared sidecar is never size-gated** and
declared telemetry is never silently dropped (see "Memory posture").

## Candidate precedence and merge

A camera can match several sidecars. DIVE gathers candidates in a fixed
precedence order, winner first:

1. the camera's own folder,
2. that camera's clone media root,
3. the dataset folder,
4. the multicamera parent root.

Within a single folder, items are sorted case-insensitively by name, and folders
are deduped by id so a shared directory is not counted twice. Merge is first-wins
at every level: the first source to claim a frame wins, and within a single file
the first row to claim an image wins. There is no value comparison, no conflict
detection, and no omitted frames. A source that does not parse as telemetry is
skipped rather than failing the camera.

For a single-camera dataset the "camera" is the dataset itself, so the chain
collapses to the dataset folder and its clone/parent root; the camera key is
`singleCam` (`SingleCameraFrameMetadataKey`).

## Read path

### Web: the sources endpoint (no parsing)

The server exposes a listing endpoint that never opens a file's bytes:

```http
GET /dive_dataset/:id/frame_metadata_sources
```

```json
{
  "cameras": {
    "singleCam": [
      { "itemId": "6630…", "name": "AUV_telemetry.meta.csv" }
    ]
  }
}
```

Cameras are keyed `singleCam` for single-camera datasets or by the multicam
camera names. Items are listed in precedence order (camera folder → clone root →
dataset folder → parent root), name-sorted within a folder and deduped by folder
id. A non-image-sequence dataset, or one with no sidecar, returns
`{"cameras": {}}`.

The browser reads this listing, downloads each item's text over the existing
Girder item-download route, builds each camera's `MediaKeyIndex` from the image
lists the viewer already holds, and runs the shared resolver in the renderer. The
resolved payload is held in a ref for the session (with a stale-response token so
a dataset switch mid-download cannot install a late result).

### Desktop

The Electron backend discovers candidate files on disk, reads their text, and
runs the same resolver in the backend, returning the resolved payload over the
`load-frame-metadata` IPC. There is no sources endpoint on desktop — discovery is
a filesystem scan — but the payload shape and the resolver are identical.

### The resolved contract

Both platforms produce the same `ResolvedFrameMetadata`
(`client/dive-common/apispec.ts`):

```typescript
interface ResolvedFrameMetadata {
  /** camera key -> (frame number -> row of cell values aligned to columns[camera]) */
  cameras: Record<string, Record<number, string[]>>;
  /** camera key -> matched sidecar filenames in precedence order (winner first) */
  sources: Record<string, string[]>;
  /** camera key -> payload column names in file / precedence order */
  columns: Record<string, string[]>;
}
```

Each frame is a **row of cell values aligned to `columns[camera]`**, never a
`{field: value}` object. Carrying column order explicitly in `columns[]` is what
lets all-numeric header names (`0`, `1`, `2`, …) render in file order instead of
JavaScript's ascending numeric-key order — the reordering that no client-side fix
could recover in the readtime object-keyed shape.

The panel renders one frame like this: for the selected camera `C` and current
frame `F`, take `row = cameras[C][F]` (`undefined` means no data this frame) and
`cols = columns[C]`, then display `cols.map((c, i) => [c, row?.[i] ?? ''])`. The
`Source:` line is `sources[C]`; whether a source exists at all is `C in sources`.

## Memory posture (no size cap)

There is no size cap anywhere — a product decision. A large sidecar is parsed
once when the dataset opens; the resolved payload keeps the compact
column-plus-rows representation, and the panel materializes a single frame's
`{column: value}` record lazily from that frame's row. The first load of a huge
sidecar is loud and proportional to file size — the panel shows a loading state —
rather than silently dropped. Slow-and-loud is acceptable; silent loss is not.

There is no windowed server read, no bounded frame window on the client, no
parse LRU, and no per-worker cache. The sidecar is resolved once per dataset open
and held for the session.

## Multicamera routing

For multicamera datasets, DIVE looks for sidecars in the parent root and in each
camera folder (plus each camera's clone root). Each camera builds its own media
filename index and selects the rows that match its own imagery.

A shared root file can route one row to multiple cameras through different
filename columns, for example `port_image` and `starboard_image`. Per-camera
child files are also supported and take precedence over the shared parent file:
because a camera's own folder is first in the precedence chain, a camera-local
value wins over a parent value for the same frame (first-wins). The `Source:`
label reflects the actual matched files per camera, so a shared parent directory
does not produce a spurious duplicate entry.

## Client behavior

Frame metadata is resolved once on dataset open (or first panel view) and held in
a session ref. The Dataset Info panel reads the active camera's current-frame row
straight from that ref, keyed on the playhead frame and the selected camera, and
displays the values in `columns` order.

Frame metadata is kept out of the annotation, attribute, and dataset-metadata
stores. Those stores have edit, save, revision, and export behavior that does not
apply to observed read-only telemetry.

## Non-goals in v1

v1 does not write `frame_metadata.json`, maintain a field registry, import a
telemetry file into annotations, or include frame telemetry in VIAME, DIVE JSON,
COCO, KWCOCO, or zip exports.

Video telemetry, embedded KLV, embedded EXIF, manually selected out-of-folder
sources, charting, and training export are future extensions behind the same
read-time contract. A future server-side export of frame metadata (for example
KWCOCO `info.dive_frame_metadata`) would reintroduce a Python parse; that is
deliberately out of scope here, and desktop export — being TypeScript — would be
unaffected.
