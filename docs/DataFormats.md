---
hide:
  - navigation
---

# Data Formats

DIVE Desktop and Web support a number of annotation and configuration formats.  The following formats can be uploaded or imported alongside your media and will be automatically parsed.

* DIVE Annotation JSON (default annotation format)
* DIVE Configuration JSON
* VIAME CSV
* COCO and KWCOCO
* KPF (KWIVER Packet Format) for MEVA

## DIVE Annotation JSON

Files are typically named `result_{dataset-name}.json`.  This JSON file is a map of numeric track identifiers to tracks, or `Record<string, TrackData>`, where TrackData is defined below.

``` typescript
interface Feature {
  frame: number;
  flick?: Readonly<number>;
  interpolate?: boolean;
  keyframe?: boolean;
  bounds?: [number, number, number, number]; // [x1, y1, x2, y2] as (left, top), (bottom, right)
  geometry?: GeoJSON.FeatureCollection<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>;
  fishLength?: number;
  attributes?: Record<string, unknown>;
  head?: [number, number];
  tail?: [number, number];
}

interface TrackData {
  trackId: TrackId;
  meta: Record<string, unknown>;
  attributes: Record<string, unknown>;
  confidencePairs: Array<[string, number]>;
  features: Array<Feature>;
  begin: number;
  end: number;
}
```

The source [TrackData definition can be found here](https://github.com/Kitware/dive/blob/main/client/src/track.ts) as a TypeScript interface.

**Example DIVE annotation file**

This is a relatively simple example, and many optional fields are not included.

```json
{
  "1": {
    "trackId": 1,
    "meta": {},
    "attributes": {},
    "confidencePairs": [["fish", 0.87], ["rock", 0.22]],
    "features": [
      { "frame": 0, "bounds": [0, 0, 10, 10], "interpolate": true },
      { "frame": 2, "bounds": [10, 10, 20, 20] },
    ],
    "begin": 0,
    "end": 2,
  },
}
```

## DIVE Configuration JSON

This information provides the specification for an individual dataset.  It consists of the following.

* Allowed types (or labels) and their appearances are defined by `customTypeStyling`
* Preset confidence filters for those types are defined in `confidenceFilters`
* Track and Detection attribute specifications are defined in `attributes`

The full [DatasetMetaMutable definition can be found here](https://github.com/Kitware/dive/blob/main/client/dive-common/apispec.ts).

```typescript
interface DatasetMetaMutable {
  version: number;
  customTypeStyling?: Record<string, CustomStyle>;
  confidenceFilters?: Record<string, number>;
  attributes?: Readonly<Record<string, Attribute>>;
}
```

## VIAME CSV

Read the [VIAME CSV Specification](https://viame.readthedocs.io/en/latest/section_links/detection_file_conversions.html).

## COCO and KWCOCO

* Read the [COCO Specification](https://cocodataset.org/#format-data)
* Read the [KWCOCO Specification](https://kwcoco.readthedocs.io/en/release/getting_started.html)

## KWIVER Packet Format (KPF)

Read the [KPF Specification](https://kwiver-diva.readthedocs.io/en/latest/kpf.html)
