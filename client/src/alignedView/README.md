# aligned view and camera registration

Multicam datasets can register each camera onto a shared reference space so the user can review annotations in an **aligned view** (SEAL-TK features 2 + 3). This folder holds the math, persistence format, reactive stores, and pure helpers that power that workflow.

Stored annotation geometry always remains in each camera's native image space; transforms here are applied at draw time and for linked pan/zoom only.

## Modules

| File | Role |
| --- | --- |
| `homography.ts` | Low-level 3×3 matrix primitives: multiply, invert, apply, solve homographies (normalized DLT), linear-system helpers, and GeoJS warp-grid utilities (`subdivideWarpQuads`, `warpGridSize`, `geojsWarpQuads`, `localLinkedScale`). |
| `transform.ts` | Higher-level alignment models (translation, rigid, similarity, affine, homography) that all return a `Matrix3`. Defines `TransformType`, UI labels, minimum point counts, and `DEFAULT_TRANSFORM_TYPE` (`similarity`). |
| `CameraRegistrationStore.ts` | Reactive Vue store for in-app calibration: picked point correspondences, fitted/loaded pair transforms, per-pair transform-type choices, and producer provenance. Loads/saves the portable registration JSON and tracks dirty state. |
| `cameraRegistrationFiles.ts` | Serialization helpers for the per-camera `<camera>_to_<reference>_registration.json` file format. Converts between the store's keyed state and self-describing file pairs; builds export bundles and filters imports to a single camera. |
| `alignedView.ts` | Pure helpers for the aligned view: compose pair homographies into per-camera native→reference matrices (`resolveToReferenceTransforms`), map geometry between cameras and reference space, and validate untrusted matrices from dataset meta. |
| `AlignedViewStore.ts` | Reactive Vue store for the aligned-view toggle: enabled/suspended state, resolved `toReference` matrices, registration progress, and `cameraTransform` / `cameraToCamera` accessors used by layers and linked navigation. |

Each module has a matching `*.spec.ts` unit test alongside it.

## How the pieces connect

```
picked points + transform type
        │
        ▼
  CameraRegistrationStore  ──fit──►  homography / transform
        │                                    │
        │ save/load                          │ pair matrices
        ▼                                    ▼
  cameraRegistrationFiles              alignedView.ts
        │                                    │
        │ export/import                      │ resolveToReferenceTransforms
        ▼                                    ▼
  desktop + web persistence            AlignedViewStore
                                             │
                                             ▼
                               layers, linked viewers, annotation warping
```

- **Calibration** flows through `CameraRegistrationStore` and `cameraRegistrationFiles` (panel, desktop on-disk files, web Girder uploads, multicam import seed).
- **Display** reads fitted pair homographies from the store, resolves every camera into the reference camera's space via `alignedView.ts`, and exposes the result through `AlignedViewStore`.
- **Math** is layered: `homography.ts` for matrices and full homographies; `transform.ts` for constrained models that need fewer point pairs on near-rigid rigs.

## Conventions

- The **reference camera** is the first camera in display order (`multiCamList[0]`). Its transform is the identity.
- Pair keys use directional `camA::camB` notation. `AtoB` maps camA pixels onto camB.
- A camera reaches the reference by breadth-first composition through the pair graph (e.g. UV→IR→EO on a three-camera rig).
- The aligned view is all-or-none: if any loaded camera lacks a path to the reference, `resolveToReferenceTransforms` returns null and the toggle stays unavailable.

## Import paths

Within `vue-media-annotator`, import from this subfolder, for example:

```ts
import AlignedViewStore from 'vue-media-annotator/alignedView/AlignedViewStore';
import { resolveToReferenceTransforms } from 'vue-media-annotator/alignedView/alignedView';
import { applyHomography } from 'vue-media-annotator/alignedView/homography';
```

Both stores are also re-exported from `vue-media-annotator/index` and wired through `provides.ts` for inject/use helpers.
