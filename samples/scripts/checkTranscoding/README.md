# DIVE Transcoding Requirements Checker

`checkTranscodingNeeded.py` checks whether local video files can be imported into DIVE without transcoding. It mirrors the skip-transcode logic used by the DIVE server and desktop app when `skip_transcoding` is enabled.

Use it to audit a media library before upload, or to generate `ffmpeg` commands for files that need conversion.

## Requirements

| Tool | Purpose |
|------|---------|
| [uv](https://docs.astral.sh/uv/) | Runs the PEP 723 script and installs `click` automatically |
| `ffmpeg` | Required on `PATH` (used to build suggested transcode commands) |
| `ffprobe` | Required on `PATH` (bundled with `ffmpeg`; used for all analysis) |

Verify tools are available:

```bash
uv --version
ffmpeg -version
ffprobe -version
```

## Usage

From the repository root:

```bash
# Single file (human-readable output)
uv run samples/scripts/checkTranscoding/checkTranscodingNeeded.py /path/to/video.mp4

# Single file (JSON)
uv run samples/scripts/checkTranscoding/checkTranscodingNeeded.py /path/to/video.mp4 --json

# Folder — recursive scan, progress bar, JSON summary, and report file
uv run samples/scripts/checkTranscoding/checkTranscodingNeeded.py --folder /path/to/videos/

# Example using the local test_videos folder (gitignored)
uv run samples/scripts/checkTranscoding/checkTranscodingNeeded.py --folder samples/scripts/checkTranscoding/test_videos/
```

### Options

| Option | Description |
|--------|-------------|
| `PATH` | Single video file to analyze |
| `--folder FOLDER` | Recursively analyze all videos under `FOLDER` |
| `--json` | JSON output for single-file mode (folder mode always prints JSON) |
| `--no-progress` | Disable the progress bar in folder mode |
| `--fail-on-transcode` | Exit with code 1 if any file needs transcoding or errors |

### Folder mode output

When `--folder` is used, the script:

1. Shows an `Analyzing videos` progress bar on stderr
2. Writes `transcoding_requirements.json` into the scanned folder
3. Prints the full JSON payload to stdout

The JSON report includes per-file results, a summary (counts and file lists), and suggested `ffmpeg` commands for files that need transcoding.

## What it checks

DIVE can skip transcoding only when **all** of the following are true. If any check fails, the file needs transcoding for browser-compatible playback.

| Check | Requirement | Why |
|-------|-------------|-----|
| Video codec | H.264 (`h264`) | Browsers play H.264 in MP4/WebM; other codecs (HEVC, AV1, VP9, etc.) must be re-encoded |
| Container | MP4 or WebM demuxer | `ffprobe` `format_name` must include `mp4` or `webm` (e.g. MPEG-TS may contain H.264 but still requires remux) |
| Sample aspect ratio | `1:1` | Non-square pixels (anamorphic video) are normalized during transcode |
| Frame timestamps | No duplicates in first 5s | Misaligned audio/video can produce duplicate frames at the start when played in the browser |

When transcoding is required, the script includes the `ffmpeg` command DIVE uses (`server/dive_tasks/tasks.py`). If duplicate beginning frames are detected, it also includes the optional realign pass from `server/dive_tasks/frame_alignment.py`.

## How it checks

### 1. Stream and container probe

Uses `ffprobe` to read format and stream metadata:

```bash
ffprobe -print_format json -v quiet -show_format -show_streams <file>
```

From the first video stream and format block it reads:

- `codec_name` — must be `h264`
- `sample_aspect_ratio` — must be `1:1`
- `format_name` — comma-separated demuxer names; at least one of `mp4` or `webm` must be present

This matches `container_allows_skip_transcoding()` in `server/dive_tasks/utils.py`.

### 2. Beginning frame timestamp check

Uses `ffprobe` to list frame timestamps for the first five seconds:

```bash
ffprobe <file> -hide_banner -read_intervals %+5 \
  -show_entries frame=best_effort_timestamp_time -print_format json -v quiet
```

The script walks frames in order. If two consecutive frames share the same `best_effort_timestamp_time`, the file is flagged as misaligned.

This matches `is_frame_misaligned()` in `server/dive_tasks/frame_alignment.py` and the desktop `checkFrameMisalignment()` in `client/platform/desktop/backend/native/mediaJobs.ts`.

### 3. Transcode command generation

For files that fail any check, the script builds the primary DIVE transcode command:

```bash
ffmpeg -i <input> \
  -c:v libx264 -preset slow -crf 22 \
  -c:a aac \
  -vf 'scale=ceil(iw*sar/2)*2:ceil(ih/2)*2,setsar=1' \
  <input>.transcoded.mp4
```

If duplicate beginning frames were detected on the **source** file, a secondary realign command is also included (run after transcode if misalignment persists):

```bash
ffmpeg -i <input>.transcoded.mp4 -ss 0 \
  -c:v libx264 -preset slow -crf 18 \
  -c:a copy \
  <input>.transcoded.aligned.mp4
```

## Supported video extensions (folder scan)

`mp4`, `webm`, `avi`, `mov`, `wmv`, `mpg`, `mpeg`, `mp2`, `ogg`, `flv`

## Source references

| DIVE component | File |
|----------------|------|
| Skip-transcode decision | `server/dive_tasks/tasks.py` (`convert_video`) |
| Container check | `server/dive_tasks/utils.py` |
| Frame misalignment | `server/dive_tasks/frame_alignment.py` |
| Desktop media check | `client/platform/desktop/backend/native/mediaJobs.ts` |

## Local test files

Place sample videos in `test_videos/` (gitignored) for manual testing. That folder is not committed to the repository.
