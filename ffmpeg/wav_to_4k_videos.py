#!/usr/bin/env python3
"""
Batch-convert WAV files into 4K still-image music videos using ffmpeg.

Output:
- 3840x2160 (4K UHD)
- MOV container
- ProRes 4444 video
- PCM 24-bit audio
- YouTube-uploadable mezzanine master

Assumptions:
- ffmpeg and ffprobe are installed and in PATH
- Cover art is a single PNG used for every track
- Input WAV files are in AUDIO_DIR
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_DIR = Path.cwd()
DEFAULT_IMAGE = DEFAULT_DIR / Path("version_3.png")
DEFAULT_AUDIO_DIR = DEFAULT_DIR # / Path("/")
DEFAULT_OUTPUT_DIR = DEFAULT_DIR / "4K_Video"


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, text=True, capture_output=True)


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        raise RuntimeError(f"Required tool not found in PATH: {name}")


def ffprobe_duration_seconds(audio_path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        str(audio_path),
    ]
    cp = run(cmd)
    data = json.loads(cp.stdout)
    return float(data["format"]["duration"])


def build_ffmpeg_command(
    image_path: Path,
    audio_path: Path,
    output_path: Path,
    fps: int,
    video_fade_sec: float = 1.0,
) -> list[str]:
    duration = ffprobe_duration_seconds(audio_path)
    fade_out_start = max(0.0, duration - video_fade_sec)
    video_filter = (
        "scale=3840:2160:force_original_aspect_ratio=decrease,"
        "pad=3840:2160:(ow-iw)/2:(oh-ih)/2,"
        f"fade=t=in:st=0:d={video_fade_sec},"
        f"fade=t=out:st={fade_out_start}:d={video_fade_sec}"
    )
    # Notes:
    # - -loop 1 repeats the still image
    # - scale/pad guarantees exact 3840x2160 without distortion
    # - -shortest ends the video when audio ends
    # - prores_ks profile 4 = ProRes 4444
    # - yuva444p10le preserves alpha-capable 4:4:4 10-bit pipeline
    # - pcm_s24le stores high-quality uncompressed 24-bit audio
    return [
        "ffmpeg",
        "-y",
        "-loop", "1",
        "-framerate", str(fps),
        "-i", str(image_path),
        "-i", str(audio_path),
        "-filter_complex",
        f"[0:v]{video_filter}[v]",
        "-map", "[v]",
        "-map", "1:a:0",
        "-c:v", "prores_ks",
        "-profile:v", "4",              # ProRes 4444
        "-pix_fmt", "yuva444p10le",
        "-vendor", "apl0",
        "-bits_per_mb", "8000",
        "-r", str(fps),
        "-c:a", "pcm_s24le",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        "-shortest",
        str(output_path),
    ]


def sanitize_output_name(path: Path) -> str:
    bad = '<>:"/\\|?*'
    name = path.stem
    for ch in bad:
        name = name.replace(ch, "_")
    return name


def convert_one(
    image_path: Path,
    audio_path: Path,
    output_dir: Path,
    fps: int,
    overwrite: bool,
) -> tuple[bool, str]:
    out_name = sanitize_output_name(audio_path) + ".mov"
    output_path = output_dir / out_name

    if output_path.exists() and not overwrite:
        return True, f"skip  {audio_path.name} -> {output_path.name} (already exists)"

    cmd = build_ffmpeg_command(image_path, audio_path, output_path, fps)

    try:
        subprocess.run(cmd, check=True, text=True, capture_output=True)
        duration = ffprobe_duration_seconds(audio_path)
        return True, f"done  {audio_path.name} -> {output_path.name} ({duration:.2f}s)"
    except subprocess.CalledProcessError as e:
        err = e.stderr[-4000:] if e.stderr else str(e)
        return False, f"fail  {audio_path.name}\n{err}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert WAV files to 4K still-image music videos."
    )
    parser.add_argument("--image", type=Path, default=DEFAULT_IMAGE, help="Cover art PNG/JPG path")
    parser.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO_DIR, help="Directory containing WAV files")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Directory for rendered videos")
    parser.add_argument("--fps", type=int, default=60, help="Video frame rate")
    parser.add_argument("--start_at_file", type=Path, default=None, help="Directory containing WAV files")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing outputs")
    args = parser.parse_args()

    try:
        require_tool("ffmpeg")
        require_tool("ffprobe")
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2

    resume_flag = False
    image_path = args.image.expanduser().resolve()
    audio_dir = args.audio_dir.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    start_at_file = args.start_at_file.expanduser().resolve()

    if start_at_file:
        resume_flag = True

    if not image_path.is_file():
        print(f"Cover art not found: {image_path}", file=sys.stderr)
        return 2

    if not audio_dir.is_dir():
        print(f"Audio directory not found: {audio_dir}", file=sys.stderr)
        return 2

    wav_files = sorted(audio_dir.glob("*.wav"))
    if not wav_files:
        print(f"No WAV files found in: {audio_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Cover art : {image_path}")
    print(f"Audio dir  : {audio_dir}")
    print(f"Output dir : {output_dir}")
    print(f"WAV count  : {len(wav_files)}")
    print()

    ok_count = 0
    fail_count = 0

    for wav in wav_files:
        if not resume_flag or (wav == start_at_file):
            resume_flag = False
            ok, message = convert_one(
                image_path=image_path,
                audio_path=wav,
                output_dir=output_dir,
                fps=args.fps,
                overwrite=args.overwrite,
            )
            print(message)
            if ok:
                ok_count += 1
            else:
                fail_count += 1

    print()
    print(f"completed: {ok_count}")
    print(f"failed   : {fail_count}")

    return 0 if fail_count == 0 else 3


if __name__ == "__main__":
    raise SystemExit(main())