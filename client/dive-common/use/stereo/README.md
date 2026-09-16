# Client-side stereo transfer and measurement (ONNX)

Warp a detection annotated on one camera onto the other camera and measure its
length, entirely in the browser / Electron renderer — no backend — running the
correspondence model with `onnxruntime-web`.

Two correspondence methods are available, chosen from **Track Settings → Stereo
Settings → Stereo point matching** (web only; desktop's method is set by the VIAME
interactive stereo config instead):

| Method | Model | How it matches |
| --- | --- | --- |
| **Lower Quality, Faster** — default | VIAME's epipolar template-matching model (stereo measurement "method 1"), bundled | Per point: generate epipolar candidates, NCC the source patch along that curve |
| **Higher Quality, Slower** | The Fast-FoundationStereo export from VIAME's `FAST-FDN-STEREO` add-on, served by the girder server | Once per frame: rectify the pair, run a dense disparity network, read each point's shift out of the map |

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
| `StereoFoundationMatcher.ts` | Loads a Fast-FoundationStereo ONNX export, rectifies the pair into the network's input resolution, caches the dense disparity map per frame, and reads each point's correspondence from it. |
| `stereoMatcher.ts` | The `StereoMatcher` contract both matchers satisfy, the `StereoMatchMethod` union, and the dropdown's labels. |
| `rectify.ts` | Stereo rectification ported from OpenCV `cvStereoRectify` (Rodrigues, rectifying rotations, point rectify/unrectify, and the inverse map used to sample a rectified image). Only the foundation method needs it. |
| `calibration.ts` | `StereoRig` + loaders (`rigFromNpz`, `rigFromJson`) mirroring VIAME's `read_stereo_rig`; `invertRig` to swap the source/target camera. |
| `npz.ts` | Minimal `.npz`/`.npy` reader (calibration files are NumPy archives). |
| `image.ts` | RGBA → BT.601 grayscale (matches OpenCV `BGR2GRAY` used by the C++ NCC). Matchers take RGBA frames; the NCC one converts, the foundation one keeps colour. |
| `frameSource.ts` | Pull full-resolution frame pixels from a GeoJS viewer / image element. |
| `triangulate.ts` | Two-view triangulation, stereo measurement (length / midpoint / range / RMS) and length aggregation, porting `viame::core::compute_stereo_measurement`. |
| `useStereoOnnxTransfer.ts` | Platform-agnostic composable: warp a box, head/tail line or polygon to the other camera, measure linked lines, bulk-warp a camera's detections, and precompute a frame's disparity ahead of a warp. |

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

Its trade is cost: the model is large (~100 MB) and each pass runs a ViT-L, so
it needs a GPU.

### Where the model comes from

The browser build is published as a **bare `.onnx`** under the
`FAST-FDN-STEREO-WEB` row (platform `WEB-ONLY`) of VIAME's
`cmake/download_viame_addons.csv`, separate from the desktop add-on zip
(`FAST-FDN-STEREO`), which carries the onnxruntime-CUDA export and a TensorRT
engine that browsers cannot use. Nothing is pinned in DIVE:

1. The girder server reads the row's URL and md5 from the CSV (until that row
   exists, or when the list cannot be fetched, it uses the builds published on
   viame.kitware.com, the 448×768 one by default; `DIVE_STEREO_WEB_MODEL=576x960`
   selects the full-size one), downloads the file once into `DIVE_MODEL_CACHE_DIR` (default `/tmp/dive_models`, a named
   volume in `docker-compose.yml`) and verifies the md5. A re-published model
   has a new md5, so it is fetched and the old copy dropped. A zip is accepted
   too (its `*_web.onnx`/single `.onnx` and yaml are extracted).
2. `GET dive_configuration/stereo_foundation_model/spec` reports the md5 and,
   when a sidecar yaml exists, the input size; `GET
   dive_configuration/stereo_foundation_model` streams the bytes. With a bare
   `.onnx` the matcher reads the fixed input size from the graph itself
   (`inputSizeOf`), so no sidecar is needed.
3. The client stores the bytes in the browser Cache API keyed by md5, so a page
   reload does not re-download.

`WEB-ONLY` rows are skipped by VIAME's desktop add-on installer and hidden from
DIVE's add-on manager. For tests or a custom export, `useStereoOnnxWeb({
foundationModelUrl, foundationModelSpec? })` bypasses the server.

### Runtime requirements

The export runs only on a GPU: the CPU (wasm) path needs several GB of
activations, past the 4 GB a wasm heap can address, so the matcher refuses to
start without `navigator.gpu` and says so. An inference failure (unsupported
operator, out of GPU memory) is remembered by the matcher and surfaced once,
rather than retried on every frame change.

Two runtime choices are deliberate, both verified probe-by-probe against CPU
onnxruntime on the fixture pair, in headless Chrome (SwiftShader) and then on
an RTX 4090 through windowed Chrome:

- **The native WebGPU provider** (`onnxruntime-web/webgpu`, imported lazily),
  not the default bundle's JSEP kernels: JSEP returns an all-zero cost volume
  for this graph (a Reshape/Cast of the right-camera features reads wrong data)
  on 1.27, 1.29 and 1.31-dev alike, on real hardware too.
- **`graphOptimizationLevel: 'basic'`**: with `'all'`, one of the provider's
  extended-level fusions corrupts the GRU gate convolutions and the disparity
  drifts by ~2 px (also on real hardware); at `'basic'` the browser output
  matches CPU to 1e-3 px.

The **export itself must be VIAME's web build** of the model
(`plugins/onnx/export_fast_foundation_stereo_web.py`, published as the
`FAST-FDN-STEREO-WEB` file): NVIDIA's stock single-file export materialises
1.5 GB correlation tensors and uses 3-D `ConvTranspose` and asymmetric 3-D
`Conv` padding that no browser provider runs. The web build is numerically
identical (~1e-4 px), cuts CPU peak memory from 16 GB to ~3 GB, and expresses
every 3-D conv as 2-D convs (the providers' 3-D conv kernel is naive and was
90% of the runtime).

Measured on an RTX 4090 Laptop GPU through Chrome, per stereo pair after the
first (warm-up) run:

| Export | Browser, native WebGPU, `basic` | CPU onnxruntime |
| --- | --- | --- |
| 576×960, 8 iterations (the add-on) | 0.69 s | 5–8 s |
| 320×736, 4 iterations | 0.26 s | ~3 s |

A hardware adapter needs Chrome in a normal window with
`--enable-features=Vulkan --enable-unsafe-webgpu` (or the matching
`chrome://flags`); headless Chrome only ever provides SwiftShader.

### How it works

1. Solve the rectifying rotations for the rig once per calibration and frame
   size (`computeRectification`), fused with a resize to the network's input
   resolution: as in OpenCV, the focal length and principal point are scaled by
   the output/source size ratio, so the whole frame lands in the network input
   rather than a centre crop of it.
2. Build the rectified pair by inverse-mapping each output pixel back to its
   source pixel and bilinear-sampling RGB, then ImageNet-normalise — the same
   preprocessing as the VIAME plugin.
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

### Precomputation and caching

Because the pass is per frame, `useStereoOnnxWeb` watches the viewer's frame
and, whenever the foundation method and auto-compute are on, calls
`precomputeFrame` for it: both warp directions (left→right, then right→left)
are queued, so the map is normally ready before the user finishes drawing.
The matcher keeps an LRU of `DEFAULT_DISPARITY_CACHE_SIZE` maps (8, i.e. four
frames in both directions), runs one inference at a time, dedupes concurrent
requests for the same frame, and drops a queued prefetch whose frame the user
has already left — unless a warp is waiting on it, which upgrades it.

### Testing status

- **Tested** (`tests/rectify.spec.ts`, `tests/stereoFoundation.spec.ts`):
  Rodrigues round-trip, orthonormality of the rectifying rotations, the
  defining rectification property (a 3D point lands on the same row in both
  rectified views, also when the output size differs from the source),
  disparity positive and decreasing with range, pixel round-trip through
  rectify/unrectify with and without distortion, the resize scaling; and,
  against a fake session returning a known disparity, the ImageNet
  preprocessing, point shift and range rejection, per-frame cache reuse,
  prefetch dropping/upgrading, serialised inference and LRU eviction.
- **Verified out of band**: the add-on's export run on CPU onnxruntime in
  Python with this preprocessing puts the fixture's head/tail disparities
  within 1 px of the NCC reference; the padding rewrite leaves the output
  bit-identical.
- **Verified in a browser on an RTX 4090**: the web export on the native
  WebGPU provider at `basic` optimisation matches CPU onnxruntime to 1e-3 px on
  the fixture pair at 0.69 s per pair. **Not yet exercised**: the end-to-end
  warp, settings dropdown and frame watcher in a running viewer. Set
  `DIVE_STEREO_FOUNDATION_MODEL` to an export to have the Node suite check its
  I/O contract.
