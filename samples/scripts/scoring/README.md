# Scoring Sample Dataset

Generate a small DIVE dataset for testing the scoring workflow: an H.264 video, ground-truth annotations, a simulated detector run, and a type configuration file.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) for running the script
- `ffmpeg` installed and available in your PATH

## Usage

From this directory:

```bash
uv run --script generate_dataset.py
```

Options:

- `--output` / `-o`: Output directory (default: `./scoring-sample`)
- `--types` / `-n`: Number of distinct track types; names are generated with Faker (default: `5`)
- `--tracks` / `-t`: Number of ground-truth tracks (default: `20`)
- `--duration` / `-d`: Video length in seconds (default: `120`)
- `--seed`: Random seed for reproducible output (default: `42`)

Example with a shorter clip and fewer tracks:

```bash
uv run --script generate_dataset.py -o ./my-scoring-data -t 10 -d 60 -n 3
```

## Files

- `sample_video.mp4` — H.264 video (no transcoding required)
- `ground_truth.dive.json` — ground-truth tracks
- `test.dive.json` — simulated detector output for scoring
- `result.json` — same as ground truth; auto-imported when opening the folder
- `config.json` — type styling and confidence filters

## Import

### Desktop

1. Import `sample_video.mp4` from the output folder.
2. DIVE should auto-attach `result.json` and `config.json`.
3. Annotations appear on the **default** set immediately (up to six tracks on frame 0).

To load the test run later: **Import Annotations** → choose `test.dive.json` (overwrite or additive).

### Web (annotation sets)

Annotation sets are **web-only**. If you import `ground_truth.dive.json` into a named set such as `groundTruth`, switch to that set in the viewer (chip next to the dataset name) before expecting to see tracks. The `default` set stays empty until you import something into it.

**Important:** Re-import the updated annotation files after pulling the latest DIVE server (annotation JSON with `fps` is no longer misclassified as configuration).

Suggested scoring layout:

1. Import the video (or upload the folder).
2. Import `ground_truth.dive.json` into set `groundTruth`.
3. Import `test.dive.json` into set `default`.
4. In Scoring, use `default` as computed and `groundTruth` as truth.

## Notes

- Annotation FPS matches the video at **30** (e.g. 3600 frames over a 2-minute clip). The dive JSON includes `"fps": 30` so the dataset timeline matches.
- Tracks are spread across the full timeline; scrub or play to see them all.
- Track type names are random English words from Faker; use `--seed` to reproduce a specific set of names.
