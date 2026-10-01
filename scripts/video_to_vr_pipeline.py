from __future__ import annotations

import argparse
import datetime as dt
import os
import shutil
import subprocess
import sys
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from pathlib import Path

from PIL import Image


MIN_COMPLETE_PLY_BYTES = 1024


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def find_ffmpeg() -> str:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise RuntimeError("ffmpeg was not found. Install ffmpeg or imageio-ffmpeg.") from exc


def run_command(args: list[str], cwd: Path | None = None) -> None:
    print("")
    print(" ".join(f'"{item}"' if " " in item else item for item in args))
    subprocess.run(args, cwd=cwd, check=True)


def ffconcat_path(path: Path) -> str:
    """Return a path string suitable for ffmpeg concat demuxer files."""
    return path.resolve().as_posix().replace("'", "'\\''")


def write_stereo_concat_list(
    stereo_frames: list[Path],
    concat_list_path: Path,
) -> None:
    lines = ["ffconcat version 1.0"]
    for frame_path in stereo_frames:
        lines.append(f"file '{ffconcat_path(frame_path)}'")
    concat_list_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def frame_path(frames_dir: Path, frame_number: int) -> Path:
    return frames_dir / f"frame_{frame_number:06d}.png"


def is_complete_image(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    try:
        with Image.open(path) as image:
            image.verify()
    except (OSError, ValueError):
        return False
    return True


def find_resume_frame(frames_dir: Path) -> int:
    """Return the first absent or unreadable frame in a contiguous sequence."""
    frame_paths = sorted(frames_dir.glob("frame_*.png"))
    if not frame_paths:
        return 1

    highest_frame = max(int(path.stem.rsplit("_", 1)[1]) for path in frame_paths)
    for frame_number in range(1, highest_frame + 1):
        if not is_complete_image(frame_path(frames_dir, frame_number)):
            return frame_number
    return highest_frame + 1


def remove_frames_from(frames_dir: Path, first_frame: int) -> None:
    for path in frames_dir.glob("frame_*.png"):
        if int(path.stem.rsplit("_", 1)[1]) >= first_frame:
            path.unlink()


def is_complete_ply(path: Path) -> bool:
    return path.is_file() and path.stat().st_size >= MIN_COMPLETE_PLY_BYTES


def stereo_frame_path(stereo_frames_dir: Path, frame_number: int) -> Path:
    return stereo_frames_dir / f"{frame_number:06d}_frame_{frame_number:06d}.sbs.png"


def batch_paths(paths: list[Path], batch_size: int) -> list[list[Path]]:
    if batch_size < 1:
        raise ValueError("Batch size must be at least 1.")
    return [paths[index : index + batch_size] for index in range(0, len(paths), batch_size)]


def default_output_dir(root: Path) -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    return root / "outputs" / f"video_vr_{stamp}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Video -> frames -> SHARP PLY -> stereo SBS frames -> VR SBS mp4 pipeline."
    )
    parser.add_argument("-i", "--input-video", required=True, type=Path)
    parser.add_argument("-o", "--output-dir", type=Path)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--ipd", type=float, default=0.064)
    parser.add_argument("--crf", type=int, default=18)
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Continue an interrupted output directory without regenerating completed PLY files.",
    )
    parser.add_argument(
        "--repair-frames-from",
        type=int,
        default=0,
        help="Replace the specified extracted frame and every following frame before resuming.",
    )
    parser.add_argument(
        "--delete-ply-after-render",
        action="store_true",
        help="After each successfully rendered SBS frame, delete its PLY to reclaim disk space.",
    )
    parser.add_argument(
        "--render-workers",
        type=int,
        default=1,
        help="Number of parallel SBS renders for PLY files that already exist (default: 1).",
    )
    parser.add_argument(
        "--ply-batch-size",
        type=int,
        default=1000,
        help="Number of PNG frames to infer before their SBS render-and-delete stage (default: 1000).",
    )
    parser.add_argument(
        "--start-seconds",
        type=float,
        default=0.0,
        help="Start extracting frames from this timestamp in seconds.",
    )
    parser.add_argument(
        "--limit-quest3",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Limit output SBS video resolution within Meta Quest 3 hardware playback limits (max 8192x4320).",
    )
    return parser.parse_args()


def extract_frames(
    ffmpeg: str,
    input_video: Path,
    frames_dir: Path,
    fps_filter: str,
    args: argparse.Namespace,
    root: Path,
) -> None:
    if not args.resume or not any(frames_dir.glob("frame_*.png")):
        extract_command = [ffmpeg, "-y"]
        if args.start_seconds > 0:
            extract_command += ["-ss", str(args.start_seconds)]
        extract_command += [
            "-i",
            str(input_video),
            "-vf",
            fps_filter,
            str(frames_dir / "frame_%06d.png"),
        ]
        run_command(extract_command, cwd=root)
        return

    existing_frame_numbers = [
        int(path.stem.rsplit("_", 1)[1]) for path in frames_dir.glob("frame_*.png")
    ]
    first_frame = args.repair_frames_from or find_resume_frame(frames_dir)
    if args.repair_frames_from and first_frame < 1:
        raise ValueError("--repair-frames-from must be at least 1.")

    if not args.repair_frames_from and first_frame > max(existing_frame_numbers):
        print(f"Frames already extracted through frame {first_frame - 1}; skipping extraction.")
        return

    remove_frames_from(frames_dir, first_frame)
    start_seconds = args.start_seconds + (first_frame - 1) / args.fps
    extract_command = [
        ffmpeg,
        "-y",
        "-i",
        str(input_video),
        "-ss",
        str(start_seconds),
        "-vf",
        fps_filter,
        "-start_number",
        str(first_frame),
        str(frames_dir / "frame_%06d.png"),
    ]
    run_command(extract_command, cwd=root)


def render_resumed_frames(
    sharp: Path,
    frames_dir: Path,
    ply_dir: Path,
    stereo_frames_dir: Path,
    ipd: float,
    delete_ply_after_render: bool,
    render_workers: int,
    ply_batch_size: int,
    root: Path,
) -> None:
    if render_workers < 1:
        raise ValueError("--render-workers must be at least 1.")
    if ply_batch_size < 1:
        raise ValueError("--ply-batch-size must be at least 1.")

    def render_existing_ply(frame_number: int, ply_path: Path) -> None:
        output_stereo_frame = stereo_frame_path(stereo_frames_dir, frame_number)
        render_temp_dir = stereo_frames_dir / ".rendering" / f"frame_{frame_number:06d}"
        render_temp_dir.mkdir(parents=True, exist_ok=True)
        for temp_frame in render_temp_dir.glob("*.sbs.png"):
            temp_frame.unlink()
        run_command(
            [
                str(sharp),
                "render-stereo-frames",
                "-i",
                str(ply_path),
                "-o",
                str(render_temp_dir),
                "--ipd",
                str(ipd),
            ],
            cwd=root,
        )
        rendered_frames = list(render_temp_dir.glob("*.sbs.png"))
        if len(rendered_frames) != 1 or not is_complete_image(rendered_frames[0]):
            raise RuntimeError(f"Stereo rendering did not create a valid frame for {ply_path}.")
        rendered_frames[0].replace(output_stereo_frame)
        if delete_ply_after_render:
            ply_path.unlink()

    def wait_for_pending(pending: set[Future[None]], wait_for_all: bool) -> None:
        while pending:
            if wait_for_all:
                done, _ = wait(pending)
            else:
                done, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                pending.remove(future)
                future.result()
            if not wait_for_all:
                return

    def infer_missing_ply_batch(image_paths: list[Path]) -> None:
        if not image_paths:
            return
        batch_inputs_dir = ply_dir.parent / ".ply_batch_inputs"
        batch_inputs_dir.mkdir(parents=True, exist_ok=True)
        for stale_input in batch_inputs_dir.glob("frame_*.png"):
            stale_input.unlink()
        for image_path in image_paths:
            batch_input_path = batch_inputs_dir / image_path.name
            try:
                os.link(image_path, batch_input_path)
            except OSError:
                shutil.copy2(image_path, batch_input_path)
        run_command(
            [
                str(sharp),
                "predict",
                "-i",
                str(batch_inputs_dir),
                "-o",
                str(ply_dir),
                "--device",
                "cuda",
            ],
            cwd=root,
        )
        incomplete = [
            image_path.stem
            for image_path in image_paths
            if not is_complete_ply(ply_dir / f"{image_path.stem}.ply")
        ]
        if incomplete:
            raise RuntimeError(f"PLY inference did not complete: {', '.join(incomplete[:5])}")
        for batch_input in batch_inputs_dir.glob("frame_*.png"):
            batch_input.unlink()
        batch_inputs_dir.rmdir()

    image_paths = sorted(frames_dir.glob("frame_*.png"))
    for image_batch in batch_paths(image_paths, ply_batch_size):
        missing_ply_images: list[Path] = []
        for image_path in image_batch:
            frame_number = int(image_path.stem.rsplit("_", 1)[1])
            output_stereo_frame = stereo_frame_path(stereo_frames_dir, frame_number)
            ply_path = ply_dir / f"{image_path.stem}.ply"
            if is_complete_image(output_stereo_frame):
                if delete_ply_after_render and ply_path.exists():
                    ply_path.unlink()
                continue
            if is_complete_ply(ply_path):
                continue
            if ply_path.exists():
                ply_path.unlink()
            missing_ply_images.append(image_path)

        infer_missing_ply_batch(missing_ply_images)

        with ThreadPoolExecutor(max_workers=render_workers) as executor:
            pending: set[Future[None]] = set()
            for image_path in image_batch:
                frame_number = int(image_path.stem.rsplit("_", 1)[1])
                output_stereo_frame = stereo_frame_path(stereo_frames_dir, frame_number)
                ply_path = ply_dir / f"{image_path.stem}.ply"
                if is_complete_image(output_stereo_frame):
                    continue
                pending.add(executor.submit(render_existing_ply, frame_number, ply_path))
                if len(pending) >= render_workers:
                    wait_for_pending(pending, wait_for_all=False)
            wait_for_pending(pending, wait_for_all=True)


def main() -> int:
    args = parse_args()
    root = project_root()
    input_video = args.input_video.resolve()
    output_dir = (args.output_dir or default_output_dir(root)).resolve()
    frames_dir = output_dir / "01_frames"
    ply_dir = output_dir / "02_ply"
    stereo_frames_dir = output_dir / "03_stereo_frames"
    concat_list_path = output_dir / "stereo_frames.ffconcat"
    final_video = output_dir / "vr_sbs_3D_FSBS.mp4"
    sharp = root / ".venv" / "Scripts" / "sharp.exe"

    if not input_video.exists():
        raise FileNotFoundError(f"Input video not found: {input_video}")
    if not sharp.exists():
        raise FileNotFoundError(f"SHARP CLI not found: {sharp}")
    if args.repair_frames_from and not args.resume:
        raise ValueError("--repair-frames-from requires --resume.")
    if args.delete_ply_after_render and not args.resume:
        raise ValueError("--delete-ply-after-render requires --resume.")
    if args.render_workers < 1:
        raise ValueError("--render-workers must be at least 1.")
    if args.ply_batch_size < 1:
        raise ValueError("--ply-batch-size must be at least 1.")

    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir.mkdir(parents=True, exist_ok=True)
    ply_dir.mkdir(parents=True, exist_ok=True)
    stereo_frames_dir.mkdir(parents=True, exist_ok=True)

    ffmpeg = find_ffmpeg()
    fps_filter = f"fps={args.fps}"
    if args.max_frames > 0:
        fps_filter = f"{fps_filter},select=lte(n\\,{args.max_frames - 1})"

    print("Video to VR SBS pipeline")
    print(f"Input:         {input_video}")
    print(f"Output:        {output_dir}")
    print(f"FPS:           {args.fps}")
    print(f"IPD:           {args.ipd}")
    print(f"Start:         {args.start_seconds} seconds")
    print(f"Frame limit:   {args.max_frames or 'none'}")
    print(f"Render workers: {args.render_workers}")
    print(f"PLY batch size: {args.ply_batch_size}")

    extract_frames(ffmpeg, input_video, frames_dir, fps_filter, args, root)

    extracted_frames = sorted(frames_dir.glob("frame_*.png"))
    if not extracted_frames:
        raise RuntimeError("No frames were extracted from the input video.")

    if args.resume:
        render_resumed_frames(
            sharp,
            frames_dir,
            ply_dir,
            stereo_frames_dir,
            args.ipd,
            args.delete_ply_after_render,
            args.render_workers,
            args.ply_batch_size,
            root,
        )
    else:
        run_command(
            [
                str(sharp),
                "predict",
                "-i",
                str(frames_dir),
                "-o",
                str(ply_dir),
                "--device",
                "cuda",
            ],
            cwd=root,
        )

    ply_files = sorted(ply_dir.glob("*.ply"))
    if not ply_files and not args.resume:
        raise RuntimeError("No PLY files were generated by SHARP.")

    if not args.resume:
        run_command(
            [
                str(sharp),
                "render-stereo-frames",
                "-i",
                str(ply_dir),
                "-o",
                str(stereo_frames_dir),
                "--ipd",
                str(args.ipd),
            ],
            cwd=root,
        )

    stereo_frames = sorted(stereo_frames_dir.glob("*.sbs.png"))
    if not stereo_frames:
        raise RuntimeError("No SBS stereo frames were generated.")

    write_stereo_concat_list(stereo_frames, concat_list_path)

    encode_command = [
        ffmpeg,
        "-y",
        "-r",
        str(args.fps),
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_list_path),
    ]
    if args.start_seconds > 0:
        encode_command += ["-ss", str(args.start_seconds)]
    encode_command += [
        "-i",
        str(input_video),
        "-map",
        "0:v:0",
        "-map",
        "1:a?",
    ]
    if args.limit_quest3:
        encode_command += [
            "-vf",
            "scale='min(8192,iw)':'min(4320,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        ]
    encode_command += [
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(args.fps),
        "-crf",
        str(args.crf),
        "-x264opts",
        "frame-packing=3",
        "-metadata:s:v:0",
        "stereo_mode=left_right",
        "-c:a",
        "aac",
        "-shortest",
        str(final_video),
    ]
    run_command(encode_command, cwd=root)

    print("")
    print("Done.")
    print(f"Frames:        {len(extracted_frames)}")
    print(f"PLY files:     {len(ply_files)}")
    print(f"SBS frames:    {len(stereo_frames)}")
    print(f"VR video:      {final_video}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"Command failed with exit code {exc.returncode}", file=sys.stderr)
        raise SystemExit(exc.returncode)
