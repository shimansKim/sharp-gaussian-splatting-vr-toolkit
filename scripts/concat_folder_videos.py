from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path


VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
MERGED_FILE_PREFIX = "sharp_merged_"


def natural_sort_key(path: Path) -> list[object]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", path.name)]


def collect_video_paths(input_folder: Path, output_path: Path) -> list[Path]:
    output_resolved = output_path.resolve()
    return sorted(
        (
            path
            for path in input_folder.iterdir()
            if path.is_file()
            and path.suffix.casefold() in VIDEO_EXTENSIONS
            and not path.name.casefold().endswith(".depth.mp4")
            and not path.name.casefold().startswith(MERGED_FILE_PREFIX)
            and path.resolve() != output_resolved
        ),
        key=natural_sort_key,
    )


def build_concat_command(concat_list_path: Path, output_path: Path) -> list[str]:
    return [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_list_path),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        str(output_path),
    ]


def write_concat_list(concat_list_path: Path, video_paths: list[Path]) -> None:
    lines = []
    for video_path in video_paths:
        escaped_path = video_path.resolve().as_posix().replace("'", r"'\''")
        lines.append(f"file '{escaped_path}'")
    concat_list_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Join color MP4 files in a folder in natural filename order.")
    parser.add_argument("input_folder", type=Path, help="Folder containing SHARP color MP4 files.")
    parser.add_argument("--output", type=Path, help="Optional destination MP4 path.")
    args = parser.parse_args()

    input_folder = args.input_folder.resolve()
    if not input_folder.is_dir():
        parser.error(f"Input folder does not exist: {input_folder}")
    if shutil.which("ffmpeg") is None:
        parser.error("ffmpeg was not found on PATH. Run the environment setup first.")

    output_path = args.output.resolve() if args.output else input_folder / f"SHARP_merged_{datetime.now():%Y%m%d-%H%M%S}.mp4"
    if output_path.exists():
        parser.error(f"Output already exists: {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    video_paths = collect_video_paths(input_folder, output_path)
    if not video_paths:
        parser.error("No color video files found. Depth videos and earlier SHARP_merged files are skipped.")

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".ffconcat",
        prefix="sharp_concat_",
        dir=input_folder,
        delete=False,
        encoding="utf-8",
        newline="\n",
    ) as temp_file:
        concat_list_path = Path(temp_file.name)

    try:
        write_concat_list(concat_list_path, video_paths)
        print(f"Joining {len(video_paths)} videos in filename order.")
        subprocess.run(build_concat_command(concat_list_path, output_path), check=True)
    finally:
        concat_list_path.unlink(missing_ok=True)

    print(f"Created: {output_path}")


if __name__ == "__main__":
    main()
