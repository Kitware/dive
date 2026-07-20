# Auto Register (deep-feature alignment) — implementation plan

Adds an **"Auto Register" button to the Camera Registration tab** (branch `dev/keypoint-gui`)
that computes a homography between two cameras of a multicam rig (e.g. EO ↔ IR) using a
deep dense feature matcher, and injects the result into the existing calibration
workflow for review, refinement, and save.

**Decisions made (2026-07-08):** desktop (Electron) first · benchmark matchers before
picking a default · model loads lazily on first use and stays resident for the session.
**Phase 0 result: MINIMA-LoFTR is the default matcher** (see Phase 0 section).

**Status (2026-07-08): Phases 0–3 implemented** on branch `dev/auto-align` in both
repos (dive: `444ce81e`; VIAME: `eb8ce809f` vendored matcher + `381829d86` backend).
Python backend verified against the 9 real kamera EO/IR pairs (standalone AND through
interactive_service routing). Client: lint clean, store unit tests added (71 pass).
Remaining: run the desktop app against a real VIAME install with
`minima_loftr.ckpt` placed in `configs/pipelines/models/` (or
`$VIAME_ALIGNMENT_WEIGHTS`), and eventually Phase 4 (web).

---

## Why no VIAME pipeline

VIAME's existing EO/IR registration is classical only (`register_multimodal_unsync_ocv.pipe`
= SIFT+RANSAC; `register_multimodal_*_itk.pipe` = ITK point-set registration). No deep
matcher (LoFTR/SuperGlue/RoMa) exists anywhere in VIAME, kamera, or seal-tk. Running a
kwiver pipeline for a one-shot two-image job is heavyweight: image-list files, full
runner spin-up, transcode checks, output plumbing, and the GPU batch-job queue.

Instead we extend the **interactive service** — the persistent Python process
(`viame.core.interactive_service`) added for the text-query / SAM feature (#1708). It
already:

- runs inside the VIAME Python environment (torch available), spawned lazily by
  `InteractiveServiceManager` (`client/platform/desktop/backend/native/interactive.ts`);
- speaks JSON-over-stdin/stdout with request ids and a 300 s timeout;
- lazy-loads models on first relevant request and keeps them resident (SAM precedent);
- already has a two-image request shape (`stereo setFrame` takes
  `left_image_path` + `right_image_path`).

Auto-register is a new command on this service, not a pipeline. GPU impact on a shared
server: one auto-register at a time per user process (the service is single-threaded
request/response), ~5 GB VRAM while the model is resident, sub-second–seconds per pair.

## Model choice (Phase 0 decides)

| Candidate | Cross-modal (RGB↔IR) | License | Notes |
|---|---|---|---|
| **RoMaV2** (requested) | ⚠️ Regressed vs v1 on WxBS IR↔RGB (55.4 vs 60.8 mAA@10px); authors acknowledge it "struggles with the IR-to-RGB multi-modal subset". No thermal training data. | Code MIT, but frozen **DINOv3** backbone = custom Meta license (attribution + redistribution terms) | Single 1.1 GB checkpoint, presets `precise/base/fast/turbo`, ~5 GB VRAM |
| **MINIMA-RoMa** | ✅ Purpose-trained on ~480M synthetic multimodal pairs; benchmarked on real RGB↔thermal homography (METU-VisTIR) | Apache-2.0 code; RoMa-v1 stack (MIT + Apache DINOv2) | Same runtime profile as RoMa v1. Likely winner. |
| **XoFTR** | ✅ Thermal↔visible-specific (semi-dense, LoFTR-style) | Apache-2.0 | Much lighter than RoMa-class; fallback if VRAM/speed matters |

All three share the integration contract: images in → matched keypoints out →
`cv2.findHomography(..., cv2.USAC_MAGSAC)`. The service treats the matcher as a
pluggable backend selected by config, so the default can change without touching DIVE.

---

## Architecture

```
RegistrationTools.vue ── "Auto Register" button (camLeft, camRight, current frame)
       │  emit / injected handler
ViewerLoader.vue ── resolve paths: stereoImagePathGetters[camLeft/Right](frame), frameTime
       │  window.ipcRenderer.invoke('interactive-auto-align', req)
ipcService.ts ──► InteractiveServiceManager.autoAlign()      (interactive.ts)
       │  {"command":"auto_align", "left_image_path", "right_image_path", ...}
viame.core.interactive_service ── auto_align handler:
       load matcher (lazy, resident) → preprocess IR → dense match
       → sample ~5000 pts → MAGSAC homography (thresh ~2 px)
       → {homography: 3x3, inliers: [[ax,ay,bx,by]…] (top ~24, spatially spread),
          inlier_ratio, model, elapsed_ms}
       │
CameraRegistrationStore ── inject inliers as correspondences → fitTransform
       → user inspects table + ghost overlay, refines, hits Save (existing path)
```

### Result injection: correspondences, not a raw matrix

The Python side runs MAGSAC and returns only **inliers**, so the client's plain DLT
(`estimateTransform('homography', …)` — no RANSAC exists client-side, and none is
needed) fits them safely. Injecting as correspondences (rather than a "loaded" matrix)
means the result:

- appears in the existing correspondences table — inspectable, deletable, draggable
  ("auto then hand-refine" for free);
- round-trips through the existing save/load/export (`cameraHomographies`,
  `cameraCorrespondences`, `cameraTransformTypes` metadata) with zero persistence work;
- flips `dirty` so the Save button lights up as usual.

No provenance stamp: `cameraRegistrationSource` is rig-global (written into every
per-camera registration file), so stamping one pair's matcher provenance there would
falsely restamp — and rewrite on save — the other cameras' files. Divergence from a
loaded producer registration surfaces through the existing refined-from-source
warning instead. Persisted per-pair matcher provenance (`{ method: 'auto', model,
inlierRatio }`) is deferred until the file format grows a pair-level source field.

---

## Phases

### Phase 0 — Benchmark ✅ (done 2026-07-08, bench code in `~/kitware/noaa/autoalign-bench`)

Ran RoMaV2 (fast/base/precise), MINIMA-RoMa, and MINIMA-LoFTR on the 9 synchronized
EO/IR pairs in `~/kitware/noaa/data/kamera_datasets` (EO 12768×9564 8-bit JPEG, IR
640×512 **16-bit** TIFF; EO downscaled to 1600 for matching — "work" coords below).
No ground-truth calibration existed, so accuracy = cross-frame consistency (same rig →
H ≈ constant across all 9 frames; corner-position std in EO-work px) + cross-model
consensus + visual warp overlays. Hardware: Apple MPS (server CUDA will be faster).

| model | ok | med inl% | worst inl% | consist mean/max px | med s/pair |
|---|---|---|---|---|---|
| **MINIMA-LoFTR** | 9/9 | 57.5 | 48.8 | **2.81 / 5.78** | **1.9** |
| MINIMA-RoMa | 9/9 | 60.9 | 47.1 | 2.81 / 5.66 | 21.2 |
| RoMaV2 base | 9/9* | 73.7 | *2.7 (garbage)* | 5.05 / 38.3 | 6.9 |
| RoMaV2 fast | 9/9* | 78.4 | *1.3 (garbage)* | 10.1 / 84.6 | 4.1 |
| RoMaV2 precise | 8/9 | 68.3 | *0.4 (garbage)* | 20.6 / 116.7 | 229 (+1 OOM) |

**Decision: MINIMA-LoFTR is the default matcher.** Equal accuracy to MINIMA-RoMa,
10× faster, 11.5M params / 44 MB weights / <1 GB VRAM (vs ~1.5 GB weights + multi-GB
VRAM for the RoMa-class models), Apache-2.0 end-to-end. Ideal for a shared GPU server.
Keep the backend pluggable; MINIMA-RoMa is the fallback/high-quality option.

Findings that shape the implementation:

- **RoMaV2's published IR↔RGB regression reproduced**: it collapsed (≤2.7% inliers,
  wrong H) on a low-contrast homogeneous forest-canopy frame that both MINIMA models
  handled at ~50–63% inliers with a visually correct warp. Multimodal fine-tuning is
  what matters, not architecture generation. RoMaV2 is out.
- On frames with structure, all models agree to ≲1.6 px (consensus check), so the
  matcher choice is about robustness on hard frames, not best-case accuracy.
- 2.81 px consistency at 1600-wide work res ≈ ~1.2 IR px — comfortably below manual
  click accuracy.
- **Quality gate needed**: reject results with inlier ratio < ~20% or a degenerate H
  (condition/det sanity) and tell the user to pick a frame with more scene structure —
  the failure mode is a real scene property (featureless canopy), not model noise.
- 16-bit IR preprocessing validated: 2–98% percentile normalize → 8-bit → 3-channel.
  IR dynamic range varies 5× between frames, so per-frame normalization is required.
- MINIMA's `DataIOWrapper` is CUDA-hardcoded (`torch.cuda.synchronize`, `np.float`) —
  drive the underlying LoFTR module directly (kornia ≥0.7 needs a one-line
  `create_meshgrid` import shim; grayscale input, long side 640, df=8).

### Phase 1 — Python: `auto_align` command (VIAME checkout)

In `viame.core.interactive_service` (same module the text-query/stereo commands live in):

- `{"command": "auto_align", "left_image_path", "right_image_path", "frame_time"?,
  "options": {"model"?, "max_dim"?, "num_samples"?, "ransac_threshold"?}}`.
- **IR preprocessing** (matters more than model choice): load 16-bit single-channel IR →
  percentile normalize (e.g. 2–98%) → 8-bit → replicate to 3 channels.
- Match → sample ~5000 correspondences → `cv2.findHomography(kptsA, kptsB,
  cv2.USAC_MAGSAC, ransacReprojThreshold≈2.0, confidence=0.999999, maxIters=10000)`
  (looser than the README's 0.2 px — appropriate for cross-modal noise).
- Select top ~24 inliers spatially spread (grid-bucket by position) for the client.
- Failure modes are structured errors: too few matches, degenerate H (checked via
  condition/determinant sanity), model not installed.
- Model backend: small registry keyed by name; **lazy load on first request, stays
  resident for the process lifetime** (mirrors SAM). `torch.manual_seed` +
  `cv2.setRNGSeed` for reproducibility.
- Weights: pre-fetch into the torch-hub cache at install time if possible; otherwise
  first-use download with a clear progress/error message.

### Phase 2 — Electron plumbing (mirror text-query end-to-end)

- `client/platform/desktop/backend/native/interactive.ts`: `autoAlign(request)` method
  modeled on `setFrame`/`textQuery`; availability probe (is the matcher package
  importable) modeled on `segmentationSam3Installed`.
- `client/platform/desktop/backend/ipcService.ts`: `interactive-auto-register` (+
  `interactive-auto-register-available`) handlers.
- `client/platform/desktop/frontend/api.ts`: `autoAlign()` + probe.
- `client/platform/desktop/frontend/components/ViewerLoader.vue`: handler resolving both
  camera image paths via `stereoImagePathGetters.value[cam]` (per-camera getters already
  exist for multicam; pass `frameTime` for video), then calling the API. Provide the
  handler down to the calibration panel (same pattern as `segmentationGetImagePath`).

### Phase 3 — Store + UI

- `client/src/CameraRegistrationStore.ts`: `applyAutoAlignment(camA, camB, inliers,
  meta)` — replaces (with confirm) the pair's correspondences, sets transform type to
  `homography`, calls the existing fit path, records source metadata.
- `client/dive-common/components/CameraCalibration/RegistrationTools.vue`:
  - "Auto Register" button next to the Transform Type block; enabled when a valid distinct
    pair is selected **and** the desktop probe says available (web renders nothing —
    same gating as `textQueryEnabled`).
  - Spinner during the request (`save()`/`saving` pattern), errors surfaced like
    `fitError`, confirm-overwrite prompt when correspondences already exist
    (`usePrompt`).
  - After success the existing ghost overlay + correspondence table give immediate
    visual verification; user refines and Saves normally.

### Phase 4 (later, optional) — Web support

Celery task on the GPU `pipelines` queue + a `dive_rpc` endpoint returning the same JSON
(queue already serializes GPU work per worker via `worker_prefetch_multiplier=1`).
Phase 3's store/UI code is platform-agnostic; only the transport differs. Out of scope
for now.

---

## Risks / notes

- **Cross-modal quality is the main risk** — hence Phase 0 before integration. If all
  matchers underperform on the actual imagery, the button can still ship as
  "auto-propose, human verifies", which the correspondence-injection design supports.
- **Licensing:** if RoMaV2 wins the benchmark, its DINOv3 backbone's Meta license
  (attribution, redistribution terms) needs a sign-off for this project; MINIMA/XoFTR
  are clean Apache-2.0.
- **VRAM residency:** resident-per-session was chosen for desktop; if multiple desktop
  sessions share one GPU box and contention appears, add an idle-TTL unload behind a
  setting (one-line policy change in the service).
- **Large-image/tiled datasets:** `getCameraImage` returns null for tiled sources, but
  the desktop path resolver (`stereoImagePathGetters`) is unaffected; only a future web
  port needs to care.
- **16-bit IR** (`dev/read-16bit-ir` branch exists): normalization in Phase 1 must match
  however DIVE renders those frames, so the picked points visually correspond.
