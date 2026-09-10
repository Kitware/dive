# Single-camera pipelines on multicam / stereo

When a pipeline runs on **one camera** of a multicamera or stereo dataset, DIVE must
avoid TrackId collisions with annotations already on the other cameras, and optionally
pair detections across a calibrated stereo pair.

## Modes

| Mode | When | Result |
|------|------|--------|
| `separate` | Default, or user declines association | Remap new track IDs above every ID on the other cameras |
| `associate` | Stereo + calibration + interactive stereo enabled + user accepts | Run VIAME association on both cameras' CSVs, then ingest paired outputs |

## Layout

| Piece | Role |
|-------|------|
| `decisions.ts` | UI/preflight: resolve camera scope, validate association, shared errors/types, ID remapping |
| `association.ts` | Shared VIAME `.pipe` text and CSV frame helper used when finishing a run |
| `AssociationDialog.vue` | Prompt: associate across cameras, keep separate IDs, or cancel |
| `index.ts` | Public re-exports for `dive-common/singleCamera` |

Platform execution (filesystem / Girder) stays outside this folder:

- **Desktop** — `platform/desktop/backend/native/singleCameraPipeline.ts` (`prepare` / `finish`), wired from `viame.ts`
- **Web** — `server/dive_tasks/single_camera_pipeline.py`, called from `run_pipeline.py`

The Vue run menu (`components/RunPipelineMenu.vue`) uses `decisions` + `AssociationDialog` before launch; backends apply the same rules after the pipeline writes CSV.

## Import

```ts
import {
  singleCameraContext,
  validateAssociation,
  remapCsvIds,
  stereoAssociationPipeline,
  lastCsvFrame,
  type SingleCameraMode,
} from 'dive-common/singleCamera';
import AssociationDialog from 'dive-common/singleCamera/AssociationDialog.vue';
```
