---
hide:
  - navigation
---

# Data Formats

DIVE Desktop and Web support a number of annotation, configuration, and
media-side metadata formats. The annotation and configuration formats below can
be uploaded or imported alongside your media and will be automatically parsed.

* DIVE Annotation JSON (default annotation format)
* DIVE Configuration JSON
* VIAME CSV
* KPF (KWIVER Packet Format)
* COCO and KWCOCO

Frame metadata sidecars are media files rather than annotation imports. See
[Frame Metadata Sidecars](Frame-Metadata.md) for their naming, placement, and
text-file format.

## DIVE Annotation JSON

!!! info
    The current DIVE schema version is v2.  Version 2 was introduced in DIVE version 1.9.0.  It is backward-compatible with v1.

Files are typically named `result_{dataset-name}.json`.  Their schema is described as follows.

``` typescript
/** AnnotationSchema is the schema of the annotation DIVE JSON file */
interface AnnotationSchema {
  tracks: Record<string, TrackData>;
  groups: Record<string, GroupData>;
  version: 2;
  /**
   * Annotation frame rate when present. Omitted when absent or unusable.
   * Same role as the VIAME CSV `# metadata` `fps` field and COCO `videos[].annotation_fps`.
   */
  fps?: number;
}

interface TrackData {
  id: AnnotationId;
  meta: Record<string, unknown>;
  /**
   * Track-level attributes. Can contain arbitrary key-value pairs.
   * 
   * Reserved attribute names (cannot be created by users):
   * - `userCreated`: Internal flag indicating user creation status.
   */
  attributes: Record<string, unknown>;
  confidencePairs: Array<[string, number]>;
  begin: number;
  end: number;
  features: Array<Feature>;
}

interface GroupData {
  id: AnnotationId;
  meta: Record<string, unknown>;
  attributes: Record<string, unknown>;
  confidencePairs: Array<[string, number]>;
  begin: number;
  end: number;
  /**
   * members describes the track members of a group,
   * including sub-intervals that they are participating in the group.
   */
  members: Record<AnnotationId, {
    ranges: [number, number][];
  }>;
}

interface Feature {
  frame: number;
  flick?: Readonly<number>;
  interpolate?: boolean;
  keyframe?: boolean;
  bounds?: [number, number, number, number]; // [x1, y1, x2, y2] as (left, top), (bottom, right)
  geometry?: GeoJSON.FeatureCollection<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>;
  fishLength?: number;
  /**
   * Detection attributes. Can contain arbitrary key-value pairs.
   * 
   * Reserved attribute names (cannot be created by users):
   * - `rotation`: Rotation angle in radians for rotated bounding boxes (counter-clockwise).
   *   When present, the `bounds` field represents an axis-aligned bounding box, and the
   *   actual rotated rectangle is computed by applying this rotation around the bbox center.
   *   Only stored if rotation is significant (|rotation| > 0.001 radians).
   * - `userModified`: Internal flag indicating user modification status.
   */
  attributes?: Record<string, unknown>;
  head?: [number, number];
  tail?: [number, number];
  /**
   * Free-form note text for this detection (frame). Stored as a string
   * array for format compatibility; DIVE typically uses a single entry.
   * Omitted when the detection has no note.
   */
  notes?: string[];
}
```

### Reserved Attribute Names

!!! warning "Reserved Attribute Names"
    Certain attribute names are reserved by DIVE and cannot be used when creating custom attributes. Attempting to create attributes with these names will result in an error.

**Reserved Detection Attributes** (stored in `Feature.attributes`):
- `rotation`: Used to store the rotation angle in radians for rotated bounding boxes. When present, the `bounds` field represents an axis-aligned bounding box, and the actual rotated rectangle is computed by applying this rotation around the bbox center. Only stored if rotation is significant (|rotation| > 0.001 radians).
- `userModified`: Internal flag used by DIVE to track user modification status.

**Reserved Track Attributes** (stored in `TrackData.attributes`):
- `userCreated`: Internal flag used by DIVE to track user creation status.

These reserved names are enforced at both the UI level (when creating attributes) and the API level (when saving attributes). If you need to use similar names, consider alternatives like `rotationAngle`, `isUserModified`, or `isUserCreated`.

The full source [TrackData definition can be found here](https://github.com/Kitware/dive/blob/main/client/src/track.ts) as a TypeScript interface.

### Annotation frame rate (`fps`)

Optional top-level `fps` carries the dataset annotation frame rate — the same value
VIAME CSV writes in the `# metadata` header and COCO/KWCOCO records on `videos[].annotation_fps`.

```json
{
  "version": 2,
  "fps": 5,
  "tracks": {},
  "groups": {}
}
```

* On export, DIVE writes a usable dataset `fps` (finite number greater than zero).
* On import, that value is restored into dataset metadata. Unusable values (`0`, negative,
  non-numeric, `inf`/`nan`) are ignored. A file with no `fps` leaves the dataset rate unchanged.
* Older v1 track-map files have no place for `fps`; only the v2 document form carries it.

### Example JSON File

This is a relatively simple example, and many optional fields are not included.

```json
{
  "version": 2,
  "fps": 5,

  "tracks": {
    // Track 1 is a true multi-frame track
    "1": {
      "id": 1,
      "meta": {},
      "attributes": {},
      "confidencePairs": [["fish", 0.87], ["rock", 0.22]],
      "features": [
        { "frame": 0, "bounds": [0, 0, 10, 10], "interpolate": true },
        { "frame": 3, "bounds": [10, 10, 20, 20], "attributes": { "rotation": 0.785 } },
      ],
      "begin": 0,
      "end": 2,
    },
    // Track 2 is a simple single-frame bounding box detection
    "2": {
      "id": 2,
      "meta": {},
      "attributes": {},
      "confidencePairs": [["scallop", 0.67]],
      "features": [
        { "frame": 3, "bounds": [10, 10, 20, 20] },
      ],
      "begin": 3,
      "end": 3,
    },
  },

  "groups": {
    "1": {
      "id": 1,
      "meta": {},
      "attributes": {},
      "confidencePairs": [["underwater-stuff", 1.0]],
      "members": {
        // The fish is a group member on frame 0, 1, and 3.
        // The scallop is only a group member at frame 3.
        "1": { "ranges": [[0, 1], [3, 3]] },
        "2": { "ranges": [[3, 3]] },
      },
      "begin": 0,
      "end": 2,
    }
  }
}
```

## DIVE Configuration JSON

This information provides the specification for an individual dataset.  It consists of the following.

* Allowed types (or labels) and their appearances are defined by `customTypeStyling` and `customGroupStyling`.
  * These fields are **per-dataset** styles in the portable Configuration File.
  * Separately, when [Type color scope](UI-Type-List.md#type-color-scope-and-saved-styles) is **Shared**, DIVE also keeps a cross-dataset style store (Desktop: `global_style_settings.json` in the [data storage path](Dive-Desktop.md#data-storage-path); Web: browser `localStorage`). That shared store is not part of this Configuration JSON export format.
* Preset confidence filters for those types are defined in `confidenceFilters`
* Track and Detection attribute specifications are defined in `attributes`
* Free-form, dataset-level metadata (cruise id, station id, location, …) is stored in `datasetInfo` as a key/value object.
  * Edited from the [Dataset Info panel](UI-DatasetInfo.md).
  * Included in DIVE Configuration JSON as `datasetInfo`.
  * Included in [VIAME CSV](#viame-csv) and [COCO / KWCOCO](#coco-and-kwcoco) export, and restored on import.
* Annotation frame rate is stored as dataset `fps`.
  * Included in [DIVE Annotation JSON](#annotation-frame-rate-fps) as top-level `fps`.
  * Included in [VIAME CSV](#dataset-metadata-in-the-header) as the `# metadata` `fps` field.
  * Included in [COCO / KWCOCO](#annotation-frame-rate-videosannotation_fps) as `videos[].annotation_fps` for video datasets.
* A track type hierarchy is stored in `typeHierarchy` as a child-type to immediate-parent-type map.

For example, this configuration makes `fish` a heading-only parent (it does not need to be an
explicit configured type or appear in a track):

```json
{
  "typeHierarchy": {
    "shark": "fish",
    "great white shark": "shark"
  }
}
```

A type hierarchy is a single-parent forest. Child and parent names must be non-empty strings,
self-edges and cycles are invalid, and each child can have only one immediate parent. Names are
preserved exactly; whitespace is used only to determine whether a name is empty.

A missing `typeHierarchy` leaves the saved hierarchy unchanged. On overwrite import or direct
save, `null` and `{}` delete it, while a non-empty map replaces it completely. Additive import
follows JSON merge semantics: `null` deletes the hierarchy, `{}` makes no change, and a non-empty
map adds edges to the existing hierarchy.
Identical edges coalesce; a different parent for an existing child or a cycle rejects the whole
configuration without changing it. Invalid saves and imports report
`Type hierarchy is invalid: {reason}. No configuration was changed.`

DIVE Configuration JSON exports include a valid non-empty hierarchy and omit an absent or empty
one. The `config.json` embedded in a dataset zip follows the same rules. Invalid stored hierarchy
prevents either configuration export and reports
`Type hierarchy is invalid: {reason}. No configuration file was exported.` It prevents KWCOCO
export and reports `Type hierarchy is invalid: {reason}. No COCO file was exported.` Hierarchy is
not transported by DIVE Annotation JSON, VIAME CSV, KPF, NIST, or `labels.txt`. KWCOCO transports it
through category `supercategory` fields as described in
[COCO and KWCOCO](#coco-and-kwcoco), including a
[hierarchy classification example](#example-kwcoco-file-with-hierarchy-classifications).

When importing a DIVE Configuration JSON with `datasetInfo`, **Overwrite** import (the
default) replaces the existing `datasetInfo` block; an additive import merges it per-key
(imported values win). A configuration file with no `datasetInfo` entry leaves existing
dataset metadata untouched.

The full [DatasetMetaMutable definition can be found here](https://github.com/Kitware/dive/blob/main/client/dive-common/apispec.ts).

```typescript
interface DatasetMetaMutable {
  version: number;
  typeHierarchy?: Record<string, string> | null;
  customTypeStyling?: Record<string, CustomStyle>;
  customGroupStyling?: Record<string, CustomStyle>;
  confidenceFilters?: Record<string, number>;
  imageEnhancements?: ImageEnhancements;
  attributes?: Readonly<Record<string, Attribute>>;
  datasetInfo?: Record<string, unknown>;
}
```

`imageEnhancements` stores viewer display settings (brightness, contrast, saturation,
sharpen, and optional percentile stretch bounds). See
[Image Enhancements](UI-Image-Enhancements.md) for platform support of high bit-depth stretch.

### Media frame metadata

Each frame in an image-sequence or multicam dataset may carry a `timestamp` field (epoch
seconds) parsed from the filename at load time. When every frame on every camera in a
multicam dataset has a timestamp, DIVE builds a global aligned timeline for playback. See
[Aligned playback and timestamps](Multicamera-data.md#aligned-playback-and-timestamps).

```typescript
interface FrameImage {
  url: string;
  filename: string;
  id?: string; // large-image item id (web tiled TIFF)
  timestamp?: number; // capture time in epoch seconds, when parseable from filename
}
```

## VIAME CSV

Read the [VIAME CSV Specification](https://viame.readthedocs.io/en/latest/sections/detection_file_conversions.html).

!!! warning
    VIAME CSV is the format that DIVE exports to.  It doesn't support all features of the annotator (like groups) so you may need to use the DIVE Json format.  It's easier to work with.

### Dataset metadata in the header

DIVE writes a `# metadata` comment line near the top of the CSV carrying dataset-level
values such as `fps`. When a dataset has [Dataset Info](UI-DatasetInfo.md) custom
metadata, the whole `datasetInfo` object is added to that line as a single nested JSON
entry keyed `dataset_info`:

```
# metadata,fps: 23.976,"dataset_info: {""gfishsite_id"": ""2024TXN012"", ""year"": ""2024""}", ...
```

* On import the `# metadata` line is parsed back into dataset metadata.
  * `fps` and the `dataset_info` block are restored; other fields (such as `exported_by`) are ignored.
  * **Overwrite** import (the default) replaces the existing `dataset_info` block; an additive import merges it per-key (imported values win).
  * A CSV with no `dataset_info` entry leaves existing metadata untouched.
* This is how dataset context, for example a `gfishsite_id` used to re-link
  annotations to an external database, travels with the exported annotations without
  renaming files. See the [Dataset Info panel](UI-DatasetInfo.md) for how to populate it.

### VIAME CSV polygons and length

DIVE extends standard VIAME CSV with additional geometry and measurement fields:

**Polygons** — one or more `(poly)` columns per row, each followed by flat `x y` coordinate pairs:

```
0,1.png,0,100,100,500,500,1.0,-1,fish,1.0,(poly) 100 100 200 100 200 200 100 200
```

**Multiple polygons** — additional `(poly)` columns on the same row:

```
..., (poly) 100 100 200 100 200 200 100 200, (poly) 300 300 400 300 400 400 300 400
```

**Holes** — `(hole)` columns follow the outer `(poly)` they belong to:

```
..., (poly) 100 100 500 100 500 500 100 500, (hole) 200 200 400 200 400 400 200 400
```

Multiple holes are supported with additional `(hole)` columns.

**Length measurements** — the standard VIAME length column (8th numeric field) stores stereo fish-length values. DIVE also reads and writes a `length` entry in detection attributes; on export, the resolved value is written to both the column and attributes when present. Interactive stereo in [DIVE Desktop](Interactive-Annotation.md) populates these values during annotation.

### VIAME CSV notes

DIVE stores a free-form note on each detection (`Feature.notes`). In VIAME CSV
it is written as a `(note)` column on the detection row:

```
0,1.png,0,100,100,500,500,1.0,-1,fish,1.0,(note) primary observation
```

* The `(note)` column is followed by the note text (whitespace after `(note)` is trimmed on import).
* Notes are per-detection (CSV row), not track-level. There is no track-scoped note token.
* On import, `(note)` text is stored in `Feature.notes` (typically a single-element `string[]`).
* On export, the note is emitted last among the token columns so DIVE Desktop and Web produce identical row order.
* If a row contains more than one `(note)` column, all values are imported into `Feature.notes` and preserved on re-export, but the DIVE UI edits a single combined note string.

## KWIVER Packet Format (KPF)

DIVE supports [MEVA KPF](https://mevadata.org/)

* Read the [KPF Specification](https://kwiver-diva.readthedocs.io/en/latest/kpf.html)
* See example data in [meva-data-repo](https://gitlab.kitware.com/meva/meva-data-repo/)

!!! info
    KPF is typically broken into 3 files, but DIVE only supports annotations being loaded as a single file. However, the 3-file breakdown is just convention and KPF can be loaded from a single combined file.

    ```bash
    # Example: create a sinlge KPF yaml annotation file for use in DIVE
    cat 2018-03-07.11-05-07.11-10-07.school.G339.*.yml > combined.yml
    ```

## COCO and KWCOCO

DIVE Web and Desktop can import and export COCO for a single dataset at a time
(an image-sequence dataset or a single video dataset). KWCOCO-compatible files
are also accepted on import.

When **Checked Types Only** is enabled, export matches the checked names against each track's raw
stored confidence pairs and removes nonmatching pairs from the exported vector. It does not replace
that evidence with the hierarchy-resolved type currently displayed in the viewer.

* Read the [COCO Specification](https://cocodataset.org/#format-data)
* Read the [KWCOCO Specification](https://kwcoco.readthedocs.io/en/release/getting_started.html)

### Export Notes

* For image-sequence datasets, exported `images[].file_name` uses dataset image filenames.
* For video datasets, DIVE exports per-frame synthetic names (for example, `frame_000123.jpg`)
  because base COCO does not define a canonical video container field.

### DIVE KWCOCO Classification Profile

DIVE Web and Desktop use the same KWCOCO profile for hierarchy and complete confidence vectors:

* `categories` contains every type in an exported confidence vector and every child or parent in
  the dataset hierarchy. A child's immediate parent is written as `supercategory`. On import, that
  field is the parent edge; a one-element `parents` list is used only when `supercategory` is
  absent.
* Every annotation retains standard `category_id` and `score` fields for the highest-confidence
  exported pair, so readers that ignore KWCOCO extensions still receive a primary category.
* Every annotation also has a dense `prob` array aligned by position with the document's complete
  `categories` array.
* `dive_confidence_pairs` stores the track's ordered sparse vector exactly. This preserves the
  difference between a missing pair and a pair explicitly scored `0`, which a dense `prob` array
  cannot express. The extension is listed in `info.dive_extensions` and takes precedence when a
  DIVE-authored file is imported again. A present but malformed extension produces one import
  warning and falls back to a valid `prob` vector or the primary category and score.

For an external KWCOCO file without `dive_confidence_pairs`, DIVE maps `prob` by the original
category-array order, including unnamed positional slots. It accepts finite numeric values, clamps
them to `[0, 1]`, keeps the ten highest entries above `0.001`, and falls back to `category_id` plus
`score` when the vector length is wrong or duplicate category names make the mapping ambiguous.
For a track whose annotations contain different vectors, the annotation at the highest frame index
wins; the greater annotation ID wins a same-frame tie, independent of file order.

Categories with missing names, duplicate names, multiple parents, invalid edges, or cycles produce
an import warning. Usable annotations are still imported. In a multicamera import, the first valid
camera hierarchy in configured camera order becomes the parent dataset hierarchy. Matching later
hierarchies coalesce; conflicting later hierarchies are skipped with a warning. Camera datasets do
not retain separate hierarchy copies.

See [Example KWCOCO file with hierarchy classifications](#example-kwcoco-file-with-hierarchy-classifications)
for a complete document that round-trips a multi-level hierarchy and an exact
confidence vector.

### DIVE COCO Attribute Extensions

COCO does not define standard fields for arbitrary track or detection attributes
or free-form notes. To preserve DIVE attributes and notes during COCO
export/import, DIVE uses extension fields on each COCO `annotation` object:

* `dive_detection_attributes`: Detection/frame-level attributes (maps to `Feature.attributes`)
* `dive_track_attributes`: Track-level attributes (maps to `Track.attributes`)
* `dive_notes`: Per-detection note (maps to `Feature.notes`)

These extension keys are declared in the COCO `info` object as:

* `info.dive_extensions = ["dive_detection_attributes", "dive_track_attributes", "dive_notes", "dive_confidence_pairs"]`

### Dataset-level metadata (`datasetInfo`)

The dataset's free-form [Dataset Info](UI-DatasetInfo.md) metadata (e.g. `gfishsite_id`,
cruise, station) is written to the COCO `info` block under a single `dive_dataset_info` key and
advertised in `info.dive_extensions`:

* `info.dive_dataset_info = { "gfishsite_id": "2024TXN012", "year": "2024", ... }`

### Annotation frame rate (`videos[].annotation_fps`)

Neither MS-COCO nor KWCOCO define a frame-rate field. On import, DIVE reads the
annotation FPS the same way VIAME writes it: a positive numeric `fps` on an entry
in the top-level `videos` table (the COCO counterpart of the VIAME CSV `# metadata`
`fps` header). Image-sequence documents typically omit `videos` and carry no rate.

```json
{
  "videos": [
    { "id": 1, "name": "clip", "fps": 5 }
  ],
  "images": [
    { "id": 1, "file_name": "frame_000000.jpg", "frame_index": 0, "video_id": 1 }
  ]
}
```

* A usable value (finite number greater than zero) is restored into dataset metadata as
  `fps`. Unusable values (`0`, negative, non-numeric, `inf`/`nan`) are ignored.
* When multiple video entries are present, the first usable `fps` wins.
* On export of a **video** dataset, DIVE writes a one-entry `videos` table with the
  annotation FPS and sets `images[].video_id`. Image-sequence exports omit `videos`
  so re-import does not treat them as video.

### Extension Field Details

The DIVE extension fields are JSON objects with user-defined key/value pairs.
Values are typically strings, numbers, or booleans.

* `annotation.dive_detection_attributes`
  * Scope: one COCO annotation (one frame-level detection)
  * DIVE mapping: `Track.features[i].attributes`
* `annotation.dive_track_attributes`
  * Scope: logical track identity across frames (`track_id`)
  * DIVE mapping: `Track.attributes`
* `annotation.dive_notes`
  * Scope: one COCO annotation (one frame-level detection)
  * Type: `string[]` (typically one entry; a single non-empty string is also accepted on import)
  * DIVE mapping: `Track.features[i].notes`
  * Legacy alias: on import, if `dive_notes` is absent, DIVE also reads `notes`

When importing, DIVE merges any keys in the attribute objects into the target
detection/track attribute dictionaries. If the same key appears in multiple
annotations belonging to the same track, later imported entries may overwrite
earlier values for that track-level key. The note is attached to the feature for
that annotation only.

### Round-Trip Behavior

For COCO files produced by DIVE:

* DIVE writes `info.dive_extensions` to advertise the extension keys used.
* DIVE writes `dive_detection_attributes` and `dive_track_attributes` on each
  annotation when attributes are present.
* DIVE writes `dive_notes` on each annotation when that feature has a note.
* DIVE writes category-aligned `prob` plus exact `dive_confidence_pairs` on each annotation.
* Re-importing that file into DIVE preserves hierarchy edges, track IDs, complete confidence
  vectors, attributes, and notes.
* For video datasets, DIVE also writes `videos[].annotation_fps` (and `images[].video_id`) so annotation
  FPS round-trips. Image-sequence exports omit `videos`. See
  [Annotation frame rate (`videos[].annotation_fps`)](#annotation-frame-rate-videosannotation_fps).

For COCO files not produced by DIVE:

* DIVE still imports standard COCO fields (`bbox`, optional polygon
  `segmentation`, optional keypoints), and reads extension fields when present.

### Supported / Unsupported COCO Features

* Supported:
  * Bounding boxes (`bbox`)
  * Polygon segmentations in list format (`segmentation: [[x1, y1, ...]]`); if `bbox` is
    omitted, DIVE derives it from the polygon's axis-aligned bounds
  * Head/tail keypoints from category keypoint labels
* Partially supported:
  * COCO has no direct equivalent for DIVE groups, so groups are not represented in COCO export.
* Partially supported:
  * Run-length encoded segmentations (RLE): the mask is decoded and imported as its
    outline, since DIVE stores geometry rather than rasters. Both COCO counts
    spellings are read: a list of run lengths, and the LEB128 string pycocotools
    writes. Holes are not representable and are dropped, and a mask that cannot be
    decoded is skipped with a warning, as before. Web import only; desktop import
    still skips RLE. Decoding needs no extra dependency: the outline is traced with
    numpy alone.

### Example COCO Annotation with DIVE Extensions

```json
{
  "info": {
    "description": "DIVE export for my-dataset",
    "dive_extensions": ["dive_detection_attributes", "dive_track_attributes", "dive_notes", "dive_confidence_pairs"]
  },
  "images": [
    { "id": 1, "file_name": "frame_000000.jpg", "frame_index": 0 }
  ],
  "categories": [
    { "id": 1, "name": "fish", "keypoints": ["head", "tail"] },
    { "id": 2, "name": "shark", "supercategory": "fish" },
    { "id": 3, "name": "crab" }
  ],
  "annotations": [
    {
      "id": 1,
      "image_id": 1,
      "category_id": 2,
      "bbox": [100, 200, 50, 80],
      "score": 0.97,
      "prob": [0.03, 0.97, 0],
      "dive_confidence_pairs": [["shark", 0.97], ["fish", 0.03]],
      "track_id": 42,
      "dive_detection_attributes": {
        "visibility": "poor",
        "occluded": true
      },
      "dive_track_attributes": {
        "reviewed": true,
        "source": "analyst"
      },
      "dive_notes": ["primary observation"]
    },
    {
      "id": 2,
      "image_id": 1,
      "category_id": 3,
      "bbox": [320, 140, 120, 90],
      "score": 0.91,
      "prob": [0, 0, 0.91],
      "dive_confidence_pairs": [["crab", 0.91]],
      "track_id": 77,
      "segmentation": [
        [320, 140, 360, 130, 430, 170, 440, 220, 360, 230, 325, 200]
      ],
      "keypoints": [350, 150, 2, 410, 210, 2],
      "num_keypoints": 2,
      "dive_detection_attributes": {
        "visibility": "clear"
      },
      "dive_track_attributes": {
        "species_confidence_note": "manual QA"
      }
    }
  ]
}
```

### Example KWCOCO file with hierarchy classifications

A DIVE type hierarchy is a child-to-parent map. This configuration:

```json
{
  "typeHierarchy": {
    "shark": "fish",
    "great white shark": "shark",
    "ray": "fish"
  }
}
```

is the forest `fish` → `shark` → `great white shark` plus unused sibling `ray`.
KWCOCO stores each immediate parent on the child category as `supercategory`.
DIVE also writes every hierarchy member into `categories`, including heading-only
parents (`fish`) and unused children (`ray`).

The annotation below scores `great white shark` highest, keeps ancestor `shark`
at an explicit `0`, and scores unrelated `rock`. Dense `prob` is aligned with
`categories` order; missing pairs become `0` there. Sparse
`dive_confidence_pairs` is the source of truth: `shark` scored `0` is kept, while
`fish` and `ray` are absent rather than zero.

```json
{
  "info": {
    "description": "DIVE export for my-dataset",
    "dive_extensions": ["dive_confidence_pairs"]
  },
  "images": [
    { "id": 1, "file_name": "frame_000000.jpg", "frame_index": 0 }
  ],
  "categories": [
    { "id": 1, "name": "shark", "supercategory": "fish" },
    { "id": 2, "name": "great white shark", "supercategory": "shark" },
    { "id": 3, "name": "rock" },
    { "id": 4, "name": "ray", "supercategory": "fish" },
    { "id": 5, "name": "fish" }
  ],
  "annotations": [
    {
      "id": 1,
      "image_id": 1,
      "category_id": 2,
      "bbox": [100, 200, 50, 80],
      "score": 0.91,
      "prob": [0, 0.91, 0.22, 0, 0],
      "dive_confidence_pairs": [
        ["shark", 0],
        ["great white shark", 0.91],
        ["rock", 0.22]
      ],
      "track_id": 42
    }
  ]
}
```

On import, that document restores:

```json
{
  "typeHierarchy": {
    "shark": "fish",
    "great white shark": "shark",
    "ray": "fish"
  }
}
```

and the track confidence vector `[["shark", 0], ["great white shark", 0.91], ["rock", 0.22]]`.

External KWCOCO files may omit `supercategory` and use a one-element `parents`
list instead. DIVE treats that as the same parent edge; `supercategory` wins when
both are present.

```json
{ "id": 1, "name": "shark", "parents": ["fish"] }
```
