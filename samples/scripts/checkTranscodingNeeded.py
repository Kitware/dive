# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "click",
# ]
# ///
"""
Check whether video files need transcoding using DIVE's skip-transcode rules.

Mirrors server/dive_tasks/tasks.py (convert_video), server/dive_tasks/utils.py
(container_allows_skip_transcoding), and server/dive_tasks/frame_alignment.py
(is_frame_misaligned).

Run with uv:
  uv run samples/scripts/checkTranscodingNeeded.py /path/to/video.mp4
  uv run samples/scripts/checkTranscodingNeeded.py --folder /path/to/videos/

Folder mode writes transcoding_requirements.json into the scanned folder.
"""

from __future__ import annotations

import json
import shlex
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List, Optional, Sequence

import click

# dive-common fileVideoTypes
VIDEO_EXTENSIONS = frozenset(
    {
        "mp4",
        "webm",
        "avi",
        "mov",
        "wmv",
        "mpg",
        "mpeg",
        "mp2",
        "ogg",
        "flv",
    }
)

# server/dive_tasks/utils.py — matches dive-common websafeVideoTypes.
_WEBSAFE_SKIP_TRANSCODE_FORMAT_FRAGMENTS = frozenset({"mp4", "webm"})
_FOLDER_OUTPUT_FILENAME = "transcoding_requirements.json"


# server/dive_tasks/tasks.py convert_video — primary transcode pass.
_DIVE_TRANSCODE_VIDEO_FILTER = (
    "scale=ceil(iw*sar/2)*2:ceil(ih/2)*2,setsar=1"
)


def dive_transcode_output_path(input_path: Path) -> Path:
    return input_path.with_suffix(".transcoded.mp4")


def dive_realign_output_path(transcoded_path: Path) -> Path:
    return transcoded_path.with_suffix(".aligned.mp4")


def build_dive_transcode_command(input_path: Path) -> List[str]:
    output_path = dive_transcode_output_path(input_path)
    return [
        "ffmpeg",
        "-i",
        str(input_path),
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "22",
        "-c:a",
        "aac",
        "-vf",
        _DIVE_TRANSCODE_VIDEO_FILTER,
        str(output_path),
    ]


def build_dive_realign_command(transcoded_path: Path) -> List[str]:
    """Secondary pass from frame_alignment.py after primary transcode."""
    aligned_path = dive_realign_output_path(transcoded_path)
    return [
        "ffmpeg",
        "-i",
        str(transcoded_path),
        "-ss",
        "0",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "18",
        "-c:a",
        "copy",
        str(aligned_path),
    ]


def command_to_shell(command: Sequence[str]) -> str:
    return shlex.join(command)


def transcode_command_fields(
    file_path: Path,
    needs_transcoding: bool,
    frame_misaligned: bool,
) -> dict:
    if not needs_transcoding:
        return {
            "transcode_output_path": None,
            "ffmpeg_command": None,
            "ffmpeg_command_shell": None,
            "ffmpeg_realign_command": None,
            "ffmpeg_realign_command_shell": None,
        }

    transcode_command = build_dive_transcode_command(file_path)
    output_path = dive_transcode_output_path(file_path)
    fields = {
        "transcode_output_path": str(output_path),
        "ffmpeg_command": transcode_command,
        "ffmpeg_command_shell": command_to_shell(transcode_command),
        "ffmpeg_realign_command": None,
        "ffmpeg_realign_command_shell": None,
    }
    if frame_misaligned:
        realign_command = build_dive_realign_command(output_path)
        fields["ffmpeg_realign_command"] = realign_command
        fields["ffmpeg_realign_command_shell"] = command_to_shell(realign_command)
    return fields


def container_allows_skip_transcoding(format_name: str) -> bool:
    """True when ffprobe format_name indicates mp4 or webm."""
    if not format_name or not str(format_name).strip():
        return False
    parts = {p.strip() for p in str(format_name).split(",") if p.strip()}
    return bool(parts & _WEBSAFE_SKIP_TRANSCODE_FORMAT_FRAGMENTS)


def run_ffprobe(args: Sequence[str]) -> dict:
    command = ["ffprobe", *args]
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise click.ClickException(
            "ffprobe not found on PATH; install ffmpeg/ffprobe."
        ) from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        raise click.ClickException(
            f"ffprobe failed ({' '.join(command)}): {stderr or exc}"
        ) from exc

    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise click.ClickException("ffprobe returned invalid JSON") from exc


def probe_media(file_path: Path) -> tuple[dict, dict, str]:
    """Return (format_info, first_video_stream, format_name)."""
    info = run_ffprobe(
        [
            "-print_format",
            "json",
            "-v",
            "quiet",
            "-show_format",
            "-show_streams",
            str(file_path),
        ]
    )
    streams = info.get("streams") or []
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    if not video_streams:
        raise click.ClickException(f"No video stream found in {file_path}")

    format_info = info.get("format") or {}
    format_name = format_info.get("format_name") or ""
    return format_info, video_streams[0], format_name


def is_frame_misaligned(file_path: Path) -> bool:
    """
    True when duplicate best_effort_timestamp_time values appear in the first
    5 seconds of frames (audio/video misalignment indicator).
    """
    frame_info = run_ffprobe(
        [
            str(file_path),
            "-hide_banner",
            "-read_intervals",
            "%+5",
            "-show_entries",
            "frame=best_effort_timestamp_time",
            "-print_format",
            "json",
            "-v",
            "quiet",
        ]
    )
    frames = frame_info.get("frames")
    if not frames:
        raise click.ClickException(
            f"Could not read ffprobe frames for {file_path}"
        )

    previous_ts = -1
    for frame in frames:
        if "best_effort_timestamp_time" not in frame:
            continue
        current_ts = frame["best_effort_timestamp_time"]
        if previous_ts != -1 and previous_ts == current_ts:
            return True
        previous_ts = current_ts
    return False


@dataclass
class TranscodeCheckResult:
    path: str
    needs_transcoding: bool
    can_skip_transcode: bool
    codec_name: str
    sample_aspect_ratio: Optional[str]
    format_name: str
    container_websafe: bool
    frame_misaligned: bool
    reasons: List[str] = field(default_factory=list)
    error: Optional[str] = None
    transcode_output_path: Optional[str] = None
    ffmpeg_command: Optional[List[str]] = None
    ffmpeg_command_shell: Optional[str] = None
    ffmpeg_realign_command: Optional[List[str]] = None
    ffmpeg_realign_command_shell: Optional[str] = None

    @property
    def status(self) -> str:
        if self.error:
            return "ERROR"
        return "TRANSCODE" if self.needs_transcoding else "OK"


def evaluate_video(file_path: Path) -> TranscodeCheckResult:
    """Apply DIVE skip-transcode rules from convert_video."""
    _, video_stream, format_name = probe_media(file_path)

    codec_name = video_stream.get("codec_name") or ""
    sample_aspect_ratio = video_stream.get("sample_aspect_ratio")
    container_websafe = container_allows_skip_transcoding(format_name)
    frame_misaligned = is_frame_misaligned(file_path)

    reasons: List[str] = []
    if codec_name != "h264":
        reasons.append(f"codec is {codec_name!r}, not h264")
    if sample_aspect_ratio != "1:1":
        reasons.append(
            f"sample aspect ratio is {sample_aspect_ratio!r}, not 1:1"
        )
    if not container_websafe:
        reasons.append(
            "container {!r} is not web-safe "
            "(expected mp4 or webm demuxer tag)".format(format_name)
        )
    if frame_misaligned:
        reasons.append(
            "duplicate frame timestamps in first 5s (misaligned A/V)"
        )

    can_skip_transcode = not reasons
    needs_transcoding = not can_skip_transcode
    command_fields = transcode_command_fields(
        file_path,
        needs_transcoding,
        frame_misaligned,
    )
    return TranscodeCheckResult(
        path=str(file_path),
        needs_transcoding=needs_transcoding,
        can_skip_transcode=can_skip_transcode,
        codec_name=codec_name,
        sample_aspect_ratio=sample_aspect_ratio,
        format_name=format_name,
        container_websafe=container_websafe,
        frame_misaligned=frame_misaligned,
        reasons=reasons,
        **command_fields,
    )


def iter_video_files_in_folder(folder: Path) -> List[Path]:
    if not folder.is_dir():
        raise click.ClickException(f"Not a directory: {folder}")

    files = sorted(
        p.resolve()
        for p in folder.rglob("*")
        if p.is_file() and p.suffix.lower().lstrip(".") in VIDEO_EXTENSIONS
    )
    if not files:
        raise click.ClickException(f"No video files found under {folder}")
    return files


def evaluate_video_safe(file_path: Path) -> TranscodeCheckResult:
    try:
        return evaluate_video(file_path)
    except click.ClickException as exc:
        return TranscodeCheckResult(
            path=str(file_path),
            needs_transcoding=True,
            can_skip_transcode=False,
            codec_name="",
            sample_aspect_ratio=None,
            format_name="",
            container_websafe=False,
            frame_misaligned=False,
            reasons=["analysis failed"],
            error=str(exc),
        )


def build_json_payload(
    results: Sequence[TranscodeCheckResult],
    folder: Optional[str] = None,
    output_file: Optional[str] = None,
) -> dict:
    ok_results = [r for r in results if r.can_skip_transcode]
    transcode_results = [
        r for r in results if r.needs_transcoding and not r.error
    ]
    error_results = [r for r in results if r.error]

    payload = {
        "summary": {
            "total": len(results),
            "can_skip_transcoding": len(ok_results),
            "needs_transcoding": len(transcode_results),
            "errors": len(error_results),
            "can_skip_files": [r.path for r in ok_results],
            "needs_transcoding_files": [r.path for r in transcode_results],
            "error_files": [r.path for r in error_results],
        },
        "results": [asdict(r) for r in results],
    }
    if folder is not None:
        payload["folder"] = folder
    if output_file is not None:
        payload["output_file"] = output_file
    return payload


def folder_output_path(folder_path: Path) -> Path:
    return folder_path / _FOLDER_OUTPUT_FILENAME


def evaluate_folder_videos(
    video_paths: Sequence[Path],
    show_progress: bool = True,
) -> List[TranscodeCheckResult]:
    results: List[TranscodeCheckResult] = []
    if show_progress:
        with click.progressbar(
            video_paths,
            label="Analyzing videos",
            show_pos=True,
        ) as bar:
            for video_path in bar:
                results.append(evaluate_video_safe(video_path))
        return results

    for video_path in video_paths:
        results.append(evaluate_video_safe(video_path))
    return results


def write_json_output(output_path: Path, payload: dict) -> None:
    output_path.write_text(
        json.dumps(payload, indent=2) + "\n",
        encoding="utf-8",
    )


def print_human_results(results: Sequence[TranscodeCheckResult]) -> None:
    transcode_count = sum(
        1 for r in results if r.needs_transcoding and not r.error
    )
    error_count = sum(1 for r in results if r.error)
    ok_count = sum(1 for r in results if r.can_skip_transcode)

    for result in results:
        click.echo(f"{result.path}")
        click.echo(f"  status: {result.status}")
        if result.error:
            click.echo(f"  error: {result.error}")
            click.echo()
            continue
        click.echo(f"  codec: {result.codec_name}")
        click.echo(f"  container (ffprobe format_name): {result.format_name}")
        click.echo(f"  sample_aspect_ratio: {result.sample_aspect_ratio}")
        if result.needs_transcoding:
            for reason in result.reasons:
                click.echo(f"  - {reason}")
            if result.ffmpeg_command_shell:
                click.echo(
                    f"  ffmpeg command: {result.ffmpeg_command_shell}"
                )
            if result.ffmpeg_realign_command_shell:
                click.echo(
                    "  ffmpeg realign command (if still misaligned after "
                    f"transcode): {result.ffmpeg_realign_command_shell}"
                )
        click.echo()

    click.echo(
        f"Summary: {ok_count} can skip transcoding, "
        f"{transcode_count} need transcoding, "
        f"{error_count} errors ({len(results)} total)"
    )


@click.command()
@click.argument(
    "path",
    required=False,
    type=click.Path(exists=True, file_okay=True, dir_okay=False, readable=True),
)
@click.option(
    "--folder",
    "folder",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, readable=True),
    help=(
        "Process all video files under FOLDER (recursive), show progress, "
        "write transcoding_requirements.json, and print JSON summary."
    ),
)
@click.option(
    "--no-progress",
    is_flag=True,
    help="Disable the progress bar when using --folder.",
)
@click.option(
    "--json",
    "as_json",
    is_flag=True,
    help="Emit JSON for a single file (folder mode always uses JSON).",
)
@click.option(
    "--fail-on-transcode",
    is_flag=True,
    help="Exit with code 1 if any file needs transcoding or errors.",
)
def main(
    path: Optional[str],
    folder: Optional[str],
    no_progress: bool,
    as_json: bool,
    fail_on_transcode: bool,
) -> None:
    """Check whether VIDEO files need transcoding per DIVE import rules."""
    if path and folder:
        raise click.UsageError("Provide either PATH or --folder, not both.")
    if not path and not folder:
        raise click.UsageError("Provide a video file PATH or --folder.")

    if folder:
        folder_path = Path(folder).resolve()
        video_paths = iter_video_files_in_folder(folder_path)
        output_path = folder_output_path(folder_path)
        results = evaluate_folder_videos(
            video_paths,
            show_progress=not no_progress,
        )
        payload = build_json_payload(
            results,
            folder=str(folder_path),
            output_file=str(output_path),
        )
        write_json_output(output_path, payload)
        click.echo(
            f"Wrote {len(results)} result(s) to {output_path}",
            err=True,
        )
        click.echo(json.dumps(payload, indent=2))
    else:
        file_path = Path(path).resolve()
        if not file_path.is_file():
            raise click.UsageError(
                f"PATH must be a video file; use --folder for directories: "
                f"{file_path}"
            )
        results = [evaluate_video(file_path)]
        if as_json:
            click.echo(json.dumps(build_json_payload(results), indent=2))
        else:
            print_human_results(results)

    if fail_on_transcode and any(
        r.needs_transcoding or r.error for r in results
    ):
        sys.exit(1)


if __name__ == "__main__":
    main()
