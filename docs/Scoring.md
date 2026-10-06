# Scoring

Scoring compares **computed** annotations (for example, detector or pipeline output) against **ground-truth** annotations and reports standard detection, tracking, and localization metrics. DIVE runs the VIAME [`viame score`](https://www.viametoolkit.org/) tool under the hood, stores the full result on each dataset, and presents it in a dedicated **Scoring** page on web and desktop.

!!! note "Not the same as per-detection confidence"
    Individual annotations can carry a classifier **confidence** (`score` or `prob` in JSON). That value is used for display filtering in the viewer. The **Scoring** feature evaluates whole annotation collections and produces metrics such as precision, mAP, MOTA, and IDF1. Scoring can also **recommend confidence filters** from a threshold sweep and write them back to your dataset configuration.

## Requirements

| Platform | Requirement |
|----------|-------------|
| **Web** | Pipelines must be enabled on the deployment (`pipelinesEnabled`). The **Scoring** tab appears in the navigation bar when this is true. |
| **Desktop** | A working [VIAME installation](Dive-Desktop.md) (same as for pipelines and training). |
| **Both** | A **computed** annotation source and a **truth** source that are not identical (different set, revision, file, or dataset). |

## Preparing your data

The usual workflow is to keep human labels and model output on the **same dataset** but in **different annotation sets** (web) or import paths (desktop).

### Web: annotation sets

On DIVE Web, use [Annotation Sets](Annotation-Sets.md) to store ground truth separately from pipeline output:

1. Import or annotate ground truth into a named set such as `groundTruth`.
2. Run a pipeline or import detector output into `default` or another named set.
3. On the Scoring page, pick **computed** = detector set and **truth** = ground-truth set.

DIVE auto-selects a set as truth when its name matches one of: `groundTruth`, `GT`, `ground_truth`, `gt`, or `truth`.

### Desktop

Desktop stores one active annotation stream per dataset. Typical layouts:

* Ground truth in the current annotations; import a detector run with **Import Annotations** and keep it as a separate file in `auxiliary/`.
* Or score annotations from one project against another using **Another dataset…** in the source picker.

### Multicamera datasets

Score **individual camera datasets**, not the multicamera parent folder. Parent folders export per-camera zip files that the scoring tool cannot read as a single sequence. On web, camera folder IDs are resolved automatically when you pick a multicam viewer URL.

## Opening the Scoring page

### Web

* Click the **Scoring** tab in the top navigation (visible when pipelines are enabled).
* Or select one or more datasets on the **Data** home page and click **Score**.
* Direct URL: `/scoring?datasetIds=<id1>,<id2>`.

### Desktop

* Click the **Scoring** tab in the navigation bar.
* Or on the **Recent** page, select projects and click **Score**.

## Running a score

The Scoring page has two main areas: **Setup** (configure and run) and **Results** (browse past runs).

### 1. Add sequences

Each row is one **sequence pair**: computed annotations compared to ground truth for that dataset.

* Add sequences with **Add sequence** (web file browser) or the **Add a sequence** dropdown.
* When you arrive from the home page with datasets selected, pairs are created automatically.
* Score **multiple sequences in one job**; metrics are pooled the same way `viame score` aggregates a folder of files.

### 2. Choose annotation sources

For each side of a pair, open the source dropdown:

| Source | Description |
|--------|-------------|
| **Current annotations** | The latest saved annotations for that dataset. |
| **Set: …** | A named [annotation set](Annotation-Sets.md) (web). |
| **Revision #…** | A point-in-time snapshot from revision history. |
| **Earlier: …** / **Browse for a file…** | A JSON or CSV file on disk (desktop). |
| **Another dataset…** | Annotations from a different DIVE dataset. |

Use the **swap** button between columns to exchange computed and truth.

### 3. Set parameters

Click **Scoring parameters** to adjust matching and reporting options. Parameters are saved in your browser's local storage and restored on your next visit.

| Parameter | Default | Description |
|-----------|---------|-------------|
| **IoU threshold** | `0.5` | Minimum box or polygon overlap for a match. |
| **Confidence threshold** | `0.0` | Computed detections below this value are ignored. Use `0` to keep all detections for PR/ROC curves. |
| **Match on** | Bounding boxes | Use polygon IoU when both sides have polygons; otherwise boxes are used. |
| **Keypoint tolerance** | `0.1` | Head/tail points within this fraction of truth length count as correct. |
| **Per class** | on | Report metrics separately for each type. |
| **Top class only** | off | Match each detection only to its highest-scoring class. |
| **Detection confidence** | off | Rank on detection confidence instead of class score. |
| **Default class** | (empty) | Class assigned to objects with no type label. |
| **Class synonyms** | (empty) | One line per canonical class: `canonical: alias, alias`. |
| **Track metrics** | on | Compute MOTA, HOTA, IDF1, and related tracking metrics. |
| **Sweep thresholds** | on | Evaluate many confidence thresholds to find a good operating point. |
| **Sweep steps** | `50` | Number of thresholds between 0 and 1. More steps take longer. |
| **Recommended filter from the sweep** | Lower of IDF1 and MOTA thresholds | How to pick a suggested per-type confidence filter from the sweep. |

### 4. Run

Click **Run**. Scoring runs as a background job (web worker or desktop local process). It does **not** lock the viewer or modify annotations until you explicitly apply recommended filters.

Only **one outstanding pipeline or scoring job per dataset** is allowed at a time.

## Reviewing results

After a run completes, open the **Results** tab and select a result from the history list.

| Tab | Contents |
|-----|----------|
| **Summary** | Headline metrics (precision, recall, F1, AP, MOTA, IDF1, HOTA, IoU, counts, and more). |
| **Classes** | Per-type breakdown of detection and tracking metrics. |
| **Confusion** | Classification confusion matrix and accuracy. |
| **Curves** | Precision–recall and ROC curves with optional threshold markers. |
| **Sweep** | Metric vs. confidence threshold plots; recommended filters per class. |
| **Errors** | Per-frame error counts and a match table (true positives, false positives, false negatives). Click a row to open that annotation in the viewer. |

### Applying recommended confidence filters

On the **Curves** or **Sweep** tab, DIVE can suggest per-type confidence thresholds from the sweep. Click **Apply recommended filters** to merge those values into each **computed** dataset's `confidenceFilters` in its configuration. This updates how the viewer hides low-confidence detections during review; it does not delete annotations.

### Export

From the results toolbar:

* **JSON** — full result file (metrics, matches, sweep data).
* **CSV** — flattened summary tables.
* **PDF** — printable report (uses the browser or desktop print dialog).

Results are stored in the dataset **auxiliary** folder (`scoring_YYYY-MM-DD_HH-mm-ss.SSS.json` on desktop; a Girder item on web).

## Metrics reference

Metrics come from `viame score`. The Scoring UI groups them as follows.

**Detection:** precision, recall, F1, average precision (AP), AP@50, AP@75, AP@[.5:.95], mAP, true/false positives and negatives.

**Localization:** mean and median IoU, center distance, size error.

**Segmentation:** polygon IoU (when both sides have polygons).

**Keypoints:** PCK and head/tail accuracy (when head/tail features are present).

**Length:** MAE, MAPE, RMSE, and bias (when length attributes exist).

**Tracking:** MOTA, MOTP, HOTA, DetA, AssA, LocA, IDF1, ID switches, fragmentations, and KWANT continuity/purity.

**Dataset:** frame, object, and track counts; classification accuracy.

Polygon, keypoint, and length groups appear only when the scored data supports them.

## Sample dataset

A small test dataset generator lives in the repository:

```bash
cd samples/scripts/scoring
uv run --script generate_dataset.py -o ./my-scoring-data -t 10 -d 60 -n 3
```

This produces a video, `ground_truth.dive.json`, and `test.dive.json`. Import ground truth into set `groundTruth` and the detector file into `default`, then score `default` vs `groundTruth`. See the [sample README](https://github.com/Kitware/dive/blob/main/samples/scripts/scoring/README.md) for full import steps.

## Scripting and API

Programmatic access is available on web deployments:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `dive_rpc/score` | Launch a scoring job. Body: `pairs`, `params`, optional `title`. |
| `GET` | `dive_scoring` | List all scoring results the user can read. |
| `GET` | `dive_dataset/{id}/scoring` | List results for one dataset. |
| `GET` | `dive_dataset/{id}/scoring/{resultId}` | Load full result JSON. |
| `DELETE` | `dive_dataset/{id}/scoring/{resultId}` | Delete a stored result. |
| `GET` | `dive_dataset/{id}/scoring_sources` | Available sets, revisions, and auxiliary files. |

Example job body:

```json
{
  "pairs": [
    {
      "computed": { "datasetId": "abc123", "set": "default" },
      "truth": { "datasetId": "abc123", "set": "groundTruth" }
    }
  ],
  "params": {
    "iouThreshold": 0.5,
    "confidenceThreshold": 0.0,
    "matchMode": "box",
    "perClass": true,
    "tracking": true,
    "sweep": true,
    "sweepInterval": 50,
    "filterEstimator": "min"
  },
  "title": "detector vs ground truth"
}
```

See [REST Endpoints](scripting/Endpoints.md) for the full API reference.

## Related documentation

* [Annotation Sets](Annotation-Sets.md) — keep ground truth and model output on one dataset.
* [Pipelines and Training](Pipeline-Documentation.md) — generate computed annotations to score.
* [Data Formats](DataFormats.md) — annotation JSON schema and per-detection confidence fields.
* [Type List](UI-Type-List.md) — confidence filters in the viewer.
