# Client-side stereo transfer and measurement (ONNX)

Warp a detection annotated on one camera onto the other camera and measure its
length, entirely in the browser / Electron renderer — no backend — using VIAME's
epipolar template-matching model (stereo measurement "method 1") exported to
ONNX and run with `onnxruntime-web`.

This is the client counterpart to the desktop backend stereo service: the
desktop `ViewerLoader` warps and measures via native IPC (`stereoTransferLine` /
`stereoTransferPoints` / `stereoMeasureLine`); this module does the equivalent
work client-side so it also works on the web.

## Modules

| File | Role |
| --- | --- |
| `StereoOnnxMatcher.ts` | Loads the `match` ONNX model and warps source points → target points via NCC along the epipolar curve. |
| `calibration.ts` | `StereoRig` + loaders (`rigFromNpz`, `rigFromJson`) mirroring VIAME's `read_stereo_rig`; `invertRig` to swap the source/target camera. |
| `npz.ts` | Minimal `.npz`/`.npy` reader (calibration files are NumPy archives). |
| `image.ts` | RGBA → BT.601 grayscale (matches OpenCV `BGR2GRAY` used by the C++ NCC). |
| `frameSource.ts` | Pull full-resolution frame pixels from a GeoJS viewer / image element. |
| `triangulate.ts` | Two-view triangulation, stereo measurement (length / midpoint / range / RMS) and length aggregation, porting `viame::core::compute_stereo_measurement`. |
| `useStereoOnnxTransfer.ts` | Platform-agnostic composable: warp a box, head/tail line or polygon to the other camera, measure linked lines, and bulk-warp a camera's detections. |

The web glue lives in `platform/web-girder/useStereoOnnxWeb.ts` and is bound to
the `Viewer`'s `stereo-annotation-complete` and `stereo-track-linked` events in
the web `ViewerLoader.vue`.

## How it works

Per warp: generate epipolar candidates from the calibration, then NCC
template-match the source patch along that curve in the target frame (this is
exactly the VIAME C++ `epipolar_template_matching` method, as a single ONNX
graph). The matcher returns the matched point + scores; the composable rebuilds
the box / head-tail / polygon feature on the other camera.

The world frame is the left (calibration) camera. When the user annotates on the
rig's right camera, the rig is inverted (`invertRig`) so the annotated camera is
the source. Measurement always runs on the un-inverted rig, so `midpoint_*` and
`midpoint_range` stay in the calibration's frame regardless of which camera was
drawn on.

Measurement (`triangulate.ts`) undistorts both observations, applies Lindstrom's
optimal correction, and solves the homogeneous DLT. The null vector comes from
the adjugate of `AᵀA` rather than an SVD — the same closed form the exported
ONNX graph uses, since ONNX has no stable SVD operator.

## Behavior

- **Boxes / polygons** warp once: an existing feature on the other camera is
  left alone. Every warped vertex must be a confident match.
- **Head/tail lines** re-warp whenever the source is edited, so an
  auto-generated line keeps tracking its source. A line a human drew is marked
  `stereo_user_line` and is never overwritten by the warp.
- **Measurement** runs once both cameras hold a line for the frame, writing
  `length` (also to the canonical `fishLength`), `midpoint_x/y/z`,
  `midpoint_range` and `stereo_rms` as detection attributes plus a track-level
  `avg_length`. A length locked with `length_method = user_set` is preserved.
- **Segmentation seeds** are not handled here: warping a SAM seed needs the
  segmentation model, so it stays a desktop/backend feature.

## Setup (web)

1. Export the model (small; method 1 has no learned weights):
   ```bash
   python plugins/onnx/export_stereo_mapping.py --model match \
       --out stereo_match.onnx --num-samples 1500
   ```
   Fewer `--num-samples` ⇒ faster client inference, slightly coarser depth
   sampling.
2. It is served from `client/public/models/stereo_match.onnx`, which `vite build`
   copies into `dist/`. Override the URL via `useStereoOnnxWeb({ modelUrl })`.
3. Attach a stereo calibration file (`.npz`/`.json`) to the dataset. The rig is
   read from the session's file stash when one was just imported, and otherwise
   downloaded from the dataset's Girder folder, so it survives a page reload.
4. Enable *Auto-compute location on other camera* and/or *Update lengths when
   modified* under Track Settings → Stereo Settings. The disparity search range
   is set there too (default 2–512 px).

## Testing status

- **Tested** (`__tests__/`, runs under `npm test`): `.npz` calibration parsing,
  grayscale conversion, and `StereoOnnxMatcher` warping points, validated against
  the VIAME C++/Python reference (matches to ~0.25 px) using `onnxruntime-web` in
  Node; plus triangulation and measurement, validated by projecting known 3D
  points through the rig (with and without distortion) and recovering them.
- **Needs live testing**: the web glue (`useStereoOnnxWeb`, ViewerLoader
  binding, calibration download, and the GeoJS frame-pixel read in
  `frameSource.geoViewerToImageElement`) is type-checked and lint-clean but has
  not been exercised in a running web viewer with a real stereo dataset.
