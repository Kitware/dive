# Client-side stereo transfer (ONNX)

Warp a detection annotated on one camera onto the other camera, entirely in the
browser / Electron renderer — no backend — using VIAME's epipolar
template-matching model (stereo measurement "method 1") exported to ONNX and run
with `onnxruntime-web`.

This is the client counterpart to the desktop backend stereo service: the
desktop `ViewerLoader` warps via native IPC (`stereoTransferLine` /
`stereoTransferPoints`); this module does the equivalent correspondence search
client-side so it also works on the web.

## Modules

| File | Role |
| --- | --- |
| `StereoOnnxMatcher.ts` | Loads the `match` ONNX model and warps source points → target points via NCC along the epipolar curve. |
| `calibration.ts` | `StereoRig` + loaders (`rigFromNpz`, `rigFromJson`) mirroring VIAME's `read_stereo_rig`; `invertRig` to swap the source/target camera. |
| `npz.ts` | Minimal `.npz`/`.npy` reader (calibration files are NumPy archives). |
| `image.ts` | RGBA → BT.601 grayscale (matches OpenCV `BGR2GRAY` used by the C++ NCC). |
| `frameSource.ts` | Pull full-resolution frame pixels from a GeoJS viewer / image element. |
| `useStereoOnnxTransfer.ts` | Platform-agnostic composable: on annotation complete, warp a box (corners) or head/tail line (keypoints) to the other camera and write the feature. |

The web glue lives in `platform/web-girder/useStereoOnnxWeb.ts` and is bound to
the `Viewer`'s `stereo-annotation-complete` event in the web `ViewerLoader.vue`.

## How it works

Per warp: generate epipolar candidates from the calibration, then NCC
template-match the source patch along that curve in the target frame (this is
exactly the VIAME C++ `epipolar_template_matching` method, as a single ONNX
graph). The matcher returns the matched point + scores; the composable rebuilds
the box / head-tail feature on the other camera.

The world frame is the left (calibration) camera. When the user annotates on the
rig's right camera, the rig is inverted (`invertRig`) so the annotated camera is
the source.

## Setup (web)

1. Export the model (small; method 1 has no learned weights):
   ```bash
   python plugins/onnx/export_stereo_mapping.py --model match \
       --out stereo_match.onnx --num-samples 1500
   ```
   Fewer `--num-samples` ⇒ faster client inference, slightly coarser depth
   sampling.
2. Serve it as a static asset at `client/public/models/stereo_match.onnx`
   (override the URL via `useStereoOnnxWeb({ modelUrl })`).
3. Load a stereo calibration file (`.npz`/`.json`) in the session, as usual for
   multi-camera datasets. Transfer no-ops if calibration, the model, or a second
   camera is missing.
4. The disparity search range defaults to `{ minDisparity: 2, maxDisparity: 512 }`;
   tune per rig via the `range` option (should become a user setting).

## Testing status

- **Tested** (`__tests__/stereoOnnx.spec.ts`, runs under `npm test`): the core —
  `.npz` calibration parsing, grayscale conversion, and `StereoOnnxMatcher`
  warping points, validated against the VIAME C++/Python reference (matches to
  ~0.25 px) using `onnxruntime-web` in Node.
- **Needs live testing**: the web glue (`useStereoOnnxWeb`, ViewerLoader
  binding, and the GeoJS frame-pixel read in `frameSource.geoViewerToImageElement`)
  is type-checked and lint-clean but has not been exercised in a running web
  viewer with a real stereo dataset.
