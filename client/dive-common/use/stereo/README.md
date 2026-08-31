# Client-side stereo transfer and measurement (ONNX)

Warp a detection annotated on one camera onto the other camera and measure its
length, entirely in the browser / Electron renderer — no backend — running the
correspondence model with `onnxruntime-web`.

Two correspondence methods are available, chosen from **Track Settings → Stereo
Settings → Correspondence method**:

| Method | Model | How it matches |
| --- | --- | --- |
| **Template matching (NCC)** — default | VIAME's epipolar template-matching model (stereo measurement "method 1"), bundled | Per point: generate epipolar candidates, NCC the source patch along that curve |
| **Foundation stereo (disparity)** | A Fast-FoundationStereo ONNX export, **not bundled** | Once per frame: rectify the pair, run a dense disparity network, read each point's shift out of the map |

They are interchangeable behind the `StereoMatcher` interface, so everything
downstream — box/line/polygon warping, measurement, bulk transfer — is identical
either way.

This is the client counterpart to the desktop backend stereo service: the
desktop `ViewerLoader` warps and measures via native IPC (`stereoTransferLine` /
`stereoTransferPoints` / `stereoMeasureLine`); this module does the equivalent
work client-side so it also works on the web.

## Modules

| File | Role |
| --- | --- |
| `StereoOnnxMatcher.ts` | Loads the `match` ONNX model and warps source points → target points via NCC along the epipolar curve. |
| `StereoFoundationMatcher.ts` | Loads a Fast-FoundationStereo ONNX export, rectifies the pair into the network's input resolution, and reads each point's correspondence from the dense disparity map. |
| `stereoMatcher.ts` | The `StereoMatcher` contract both matchers satisfy, the `StereoMatchMethod` union, and the dropdown's labels. |
| `rectify.ts` | Stereo rectification ported from OpenCV `cvStereoRectify` (Rodrigues, rectifying rotations, point rectify/unrectify, and the inverse map used to sample a rectified image). Only the foundation method needs it. |
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

1. The model is committed at `client/public/models/stereo_match.onnx`, which
   `vite build` copies into `dist/`. Override the URL via
   `useStereoOnnxWeb({ modelUrl })`. To regenerate it (small; method 1 has no
   learned weights):
   ```bash
   python plugins/onnx/export_stereo_mapping.py --model match \
       --out client/public/models/stereo_match.onnx \
       --template-size 13 --num-samples 5000
   ```
   These are not the exporter's own defaults (25 / 5000) — they match the
   desktop config below. `--num-samples` trades client inference speed against
   depth-sampling resolution.
2. Attach a stereo calibration file (`.npz`/`.json`) to the dataset. The rig is
   read from the session's file stash when one was just imported, and otherwise
   downloaded from the dataset's Girder folder, so it survives a page reload.
3. Enable *Auto-compute location on other camera* and/or *Update lengths when
   modified* under Track Settings → Stereo Settings.

### Matching parameters

Held identical to what the desktop interactive stereo service loads from
`configs/pipelines/interactive_stereo_template.conf`, so both platforms accept
the same matches. Hidden config there and here — no UI on either side.

| Config key | Value | Where it lives here |
| --- | --- | --- |
| `epipolar_min_disparity` / `epipolar_max_disparity` | 2 / 300 px | `DEFAULT_RANGE` in `useStereoOnnxWeb`, overridable via `{ range }` |
| `template_matching_threshold` | 0.5 | `DEFAULT_THRESHOLD` in `StereoOnnxMatcher` |
| uniqueness ratio | 0 (disabled) | `DEFAULT_UNIQUENESS_RATIO`; the desktop service applies no uniqueness test |
| `template_size` | 13 | baked into the ONNX graph at export |
| `epipolar_num_samples` | 5000 | baked into the ONNX graph at export |

The disparity range is scene-dependent — VIAME's batch measurement pipes ship
7–724 for other rigs — so a rig outside 2–300 needs the `range` override.

## Testing status

- **Tested** (`tests/`, runs under `npm test`): `.npz` calibration parsing,
  grayscale conversion, and `StereoOnnxMatcher` warping points, validated against
  the VIAME C++/Python reference (matches to ~0.25 px) using `onnxruntime-web` in
  Node; plus triangulation and measurement, validated by projecting known 3D
  points through the rig (with and without distortion) and recovering them.
- **Needs live testing**: the web glue (`useStereoOnnxWeb`, ViewerLoader
  binding, calibration download, and the GeoJS frame-pixel read in
  `frameSource.geoViewerToImageElement`) is type-checked and lint-clean but has
  not been exercised in a running web viewer with a real stereo dataset.


## Foundation stereo method

### Why a second method

The NCC matcher needs the source patch to be photometrically matchable in the
other view. Where that fails — obstructed viewpoints, repetitive substrate, low
contrast — it either mismatches or declines. A dense disparity network does not
depend on patch correlation, and it costs one network pass per frame no matter
how many points are warped, so bulk-warping a whole camera amortises well.

Its trade is setup: the model is large and must be supplied.

### Supplying the model

Unlike the NCC graph (small, committed at `client/public/models/stereo_match.onnx`),
Fast-FoundationStereo exports run ~100 MB and are **not** committed. Obtain an
export from the Fast-FoundationStereo release, serve it, and point the web glue
at it:

```ts
useStereoOnnxWeb({
  ...,
  foundationModelUrl: '/models/stereo_foundation.onnx',
  foundationModelSpec: { height: 576, width: 960 },  // the export's sidecar image_size
});
```

The default URL is `/models/stereo_foundation.onnx` and the default spec is
576×960. `foundationModelSpec` **must** match the export: the graph fixes its
input resolution, and the sidecar `.yaml` shipped beside each export gives it as
`image_size: [H, W]`. With no model served, selecting the method reports that it
could not load and the warp no-ops — the same way a missing calibration does.

### How it works

1. Solve the rectifying rotations for the rig once per calibration
   (`computeRectification`), sized to the network's input resolution.
2. Build the rectified pair by inverse-mapping each output pixel back to its
   source pixel and bilinear-sampling. Rectify and resize are fused, so the cost
   is the network's resolution rather than the frame's.
3. Run the network to get dense disparity in rectified pixels.
4. Per point: rectify it, pool the disparities in a small window by median,
   shift `x` by that disparity, and unrectify into the target image.

Step 4 pools rather than sampling the single pixel deliberately. A head or tail
tip is a couple of pixels wide at the network's working resolution, so the
disparity exactly at the tip is frequently the background's; the median over a
small window rejects that without dragging the estimate off the animal.

The network emits no confidence channel, so the reported `score` is the fraction
of the pooled window carrying a finite positive disparity, and a match is
accepted when that clears `DEFAULT_MIN_VALID_FRACTION` **and** the implied
disparity falls inside the configured search range — the same range that bounds
the NCC search.

### Testing status

- **Tested** (`tests/rectify.spec.ts`): Rodrigues round-trip, orthonormality of
  the rectifying rotations, the defining rectification property (a 3D point
  lands on the same row in both rectified views), disparity positive and
  decreasing with range, and pixel round-trip through rectify/unrectify with and
  without distortion.
- **Not tested**: `StereoFoundationMatcher` end-to-end, which needs a ~100 MB
  model the repo does not carry. The geometry it depends on is covered above;
  the network call, disparity pooling and the settings dropdown have not been
  exercised against a real export in a running viewer.
