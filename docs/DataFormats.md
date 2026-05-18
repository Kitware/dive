---
hide:
  - navigation
---

# Data Formats

DIVE Desktop and Web support a number of annotation and configuration formats.  The following formats can be uploaded or imported alongside your media and will be automatically parsed.

* DIVE Annotation JSON (default annotation format)
* DIVE Configuration JSON
* VIAME CSV
* KPF (KWIVER Packet Format)
* COCO and KWCOCO

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

### Example JSON File

This is a relatively simple example, and many optional fields are not included.

```json
{
  "version": 2,

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
* Preset confidence filters for those types are defined in `confidenceFilters`
* Track and Detection attribute specifications are defined in `attributes`

The full [DatasetMetaMutable definition can be found here](https://github.com/Kitware/dive/blob/main/client/dive-common/apispec.ts).

```typescript
interface DatasetMetaMutable {
  version: number;
  customTypeStyling?: Record<string, CustomStyle>;
  customGroupStyling?: Record<string, CustomStyle>;
  confidenceFilters?: Record<string, number>;
  imageEnhancments?: ImageEnhancements;
  attributes?: Readonly<Record<string, Attribute>>;
}
```

## VIAME CSV

Read the [VIAME CSV Specification](https://viame.readthedocs.io/en/latest/sections/detection_file_conversions.html).

!!! warning
    VIAME CSV is the format that DIVE exports to.  It doesn't support all features of the annotator (like groups) so you may need to use the DIVE Json format.  It's easier to work with.

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

* Read the [COCO Specification](https://cocodataset.org/#format-data)
* Read the [KWCOCO Specification](https://kwcoco.readthedocs.io/en/release/getting_started.html)

### Export Notes

* For image-sequence datasets, exported `images[].file_name` uses dataset image filenames.
* For video datasets, DIVE exports per-frame synthetic names (for example, `frame_000123.jpg`)
  because base COCO does not define a canonical video container field.

### DIVE COCO Attribute Extensions

COCO does not define standard fields for arbitrary track or detection attributes.
To preserve DIVE attributes during COCO export/import, DIVE uses extension fields
on each COCO `annotation` object:

* `dive_detection_attributes`: Detection/frame-level attributes (maps to `Feature.attributes`)
* `dive_track_attributes`: Track-level attributes (maps to `Track.attributes`)

These extension keys are declared in the COCO `info` object as:

* `info.dive_extensions = ["dive_detection_attributes", "dive_track_attributes"]`

### Extension Field Details

The DIVE extension fields are JSON objects with user-defined key/value pairs.
Values are typically strings, numbers, or booleans.

* `annotation.dive_detection_attributes`
  * Scope: one COCO annotation (one frame-level detection)
  * DIVE mapping: `Track.features[i].attributes`
* `annotation.dive_track_attributes`
  * Scope: logical track identity across frames (`track_id`)
  * DIVE mapping: `Track.attributes`

When importing, DIVE merges any keys in these objects into the target
detection/track attribute dictionaries. If the same key appears in multiple
annotations belonging to the same track, later imported entries may overwrite
earlier values for that track-level key.

### Round-Trip Behavior

For COCO files produced by DIVE:

* DIVE writes `info.dive_extensions` to advertise the extension keys used.
* DIVE writes `dive_detection_attributes` and `dive_track_attributes` on each
  annotation when attributes are present.
* Re-importing that file into DIVE preserves those attributes.

For COCO files not produced by DIVE:

* DIVE still imports standard COCO fields (`bbox`, optional polygon
  `segmentation`, optional keypoints), and reads extension fields when present.

### Supported / Unsupported COCO Features

* Supported:
  * Bounding boxes (`bbox`)
  * Polygon segmentations in list format (`segmentation: [[x1, y1, ...]]`)
  * Head/tail keypoints from category keypoint labels
* Partially supported:
  * COCO has no direct equivalent for DIVE groups, so groups are not represented in COCO export.
* Unsupported:
  * Run-length encoded segmentations (RLE)

### Example COCO Annotation with DIVE Extensions

```json
{
  "info": {
    "description": "DIVE export for my-dataset",
    "dive_extensions": ["dive_detection_attributes", "dive_track_attributes"]
  },
  "images": [
    { "id": 1, "file_name": "frame_000000.jpg", "frame_index": 0 }
  ],
  "categories": [
    { "id": 1, "name": "fish", "keypoints": ["head", "tail"] },
    { "id": 2, "name": "crab" }
  ],
  "annotations": [
    {
      "id": 1,
      "image_id": 1,
      "category_id": 1,
      "bbox": [100, 200, 50, 80],
      "score": 0.97,
      "track_id": 42,
      "dive_detection_attributes": {
        "visibility": "poor",
        "occluded": true
      },
      "dive_track_attributes": {
        "reviewed": true,
        "source": "analyst"
      }
    },
    {
      "id": 2,
      "image_id": 1,
      "category_id": 2,
      "bbox": [320, 140, 120, 90],
      "score": 0.91,
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
