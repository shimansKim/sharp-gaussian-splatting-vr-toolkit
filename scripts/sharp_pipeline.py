#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SHARP Gaussian Splatting VR Master Pipeline Core Engine
Unified pipeline supporting:
  Video / Image / PLY -> PLY / Image / Video (Mono/SBS Stereo) / YouTube 3D / Meural Canvas 27"
Features:
  - Multi-worker concurrent SBS rendering (--render-workers)
  - Chunked batch PLY generation (--ply-batch-size)
  - Automatic intermediate disk cleanup (--clean-ply)
  - Smart resume and checkpointing (--resume)
  - Netgear Meural Canvas II (27" MC327) Preset (--preset meural / --meural)
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import os
import shutil
import subprocess
import sys
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Literal

from PIL import Image


VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".m4v"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
PLY_EXTS = {".ply"}

MIN_COMPLETE_PLY_BYTES = 1024

# "quest3_8k" preset: limits for PC streaming players such as 4XVR / 4XLink (8K @ 60fps).
# These are NOT the limits of the Quest browser app. For the app use --mode quest_app (HEVC) below.
QUEST3_MAX_WIDTH = 8192
QUEST3_MAX_HEIGHT = 4320

# Quest app (quest-app, Quest Browser): H.264 stops at 4K, HEVC/AV1 up to 8192x4096 @ 60fps.
QUEST_APP_MAX_WIDTH = 8192
QUEST_APP_MAX_HEIGHT = 4096
QUEST_APP_MAX_FPS = 60
QUEST_APP_DEFAULT_QUALITY = 24  # CQ / CRF (lower is higher quality)

# key -> (ffmpeg encoder, quality-based rate-control args; {q} is replaced by the quality value)
HEVC_ENCODERS: dict[str, tuple[str, list[str]]] = {
    "nvenc": ("hevc_nvenc", ["-preset", "p5", "-rc", "vbr", "-cq", "{q}", "-b:v", "0", "-maxrate", "80M", "-bufsize", "160M"]),
    "qsv": ("hevc_qsv", ["-preset", "medium", "-global_quality", "{q}"]),
    "amf": ("hevc_amf", ["-quality", "quality", "-rc", "cqp", "-qp_i", "{q}", "-qp_p", "{q}"]),
    "x265": ("libx265", ["-preset", "medium", "-crf", "{q}"]),
}
HEVC_ENCODER_ORDER = ["nvenc", "qsv", "amf", "x265"]  # hardware first, CPU last (always available)


def build_quest3_scale_filter(max_w: int = QUEST3_MAX_WIDTH, max_h: int = QUEST3_MAX_HEIGHT) -> str:
    """Return an FFmpeg video filter that preserves aspect ratio and ensures dimensions <= max_w x max_h (with even dimensions)."""
    return f"scale='min({max_w},iw)':'min({max_h},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2"


def ensure_cuda_msvc_env() -> None:
    """Ensure CUDA, MSVC cl.exe, and Ninja compiler tools are always injected into os.environ."""
    # 1. CUDA setup
    cuda_path = os.environ.get("CUDA_PATH", r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8")
    if Path(cuda_path).is_dir():
        os.environ["CUDA_PATH"] = cuda_path
        cuda_bin = str(Path(cuda_path) / "bin")
        if cuda_bin not in os.environ.get("PATH", ""):
            os.environ["PATH"] = cuda_bin + os.pathsep + os.environ.get("PATH", "")

    os.environ["TORCH_CUDA_ARCH_LIST"] = os.environ.get("TORCH_CUDA_ARCH_LIST", "8.9")
    os.environ["VSLANG"] = "1033"

    # 2. Check if cl.exe and ninja are already in PATH
    has_cl = shutil.which("cl") is not None
    has_ninja = shutil.which("ninja") is not None

    if not (has_cl and has_ninja):
        # 3. Locate vcvars64.bat and capture environment
        vcvars_candidates = [
            r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
            r"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
            r"C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat",
            r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat",
            r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat",
            r"C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
        ]

        vcvars_path = None
        for candidate in vcvars_candidates:
            if Path(candidate).is_file():
                vcvars_path = candidate
                break

        if vcvars_path:
            try:
                dump_cmd = f'"{vcvars_path}" >nul 2>&1 && set'
                output = subprocess.check_output(dump_cmd, shell=True, text=True, errors="ignore")
                for line in output.splitlines():
                    if "=" in line:
                        key, _, val = line.partition("=")
                        if key.upper() in ("PATH", "INCLUDE", "LIB", "LIBPATH", "VSINSTALLDIR", "VCTOOLSINSTALLDIR"):
                            os.environ[key] = val
            except Exception as exc:
                print(f"[WARN] Failed to initialize vcvars64: {exc}")

    # 4. Search for Ninja explicitly if still not found
    if shutil.which("ninja") is None:
        ninja_candidates = [
            r"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe",
            r"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe",
            r"C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe",
            r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe",
        ]
        for nc in ninja_candidates:
            if Path(nc).is_file():
                ninja_dir = str(Path(nc).parent)
                os.environ["PATH"] = ninja_dir + os.pathsep + os.environ.get("PATH", "")
                break


# Initialize compiler environment on startup
ensure_cuda_msvc_env()


def get_project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def get_python_exe() -> str:
    venv_py = get_project_root() / ".venv" / "Scripts" / "python.exe"
    if venv_py.is_file():
        return str(venv_py)
    return sys.executable


def get_sharp_cli() -> Path:
    sharp_exe = get_project_root() / ".venv" / "Scripts" / "sharp.exe"
    if sharp_exe.is_file():
        return sharp_exe
    cli = shutil.which("sharp")
    if cli:
        return Path(cli)
    raise FileNotFoundError(
        f"SHARP CLI not found at '{sharp_exe}'. Please run 'bat\\run_setup_environment.bat' first."
    )


def get_ffmpeg_exe() -> str:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    default_win = Path(r"C:\Program Files\ffmpeg\bin\ffmpeg.exe")
    if default_win.is_file():
        return str(default_win)
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise RuntimeError(
            "FFmpeg was not found. Please install FFmpeg or run environment setup."
        ) from exc


def get_spatial_media_tool() -> Path | None:
    spatial_tool = get_project_root() / "tools" / "spatial-media" / "spatialmedia"
    if spatial_tool.is_dir() or spatial_tool.is_file():
        return spatial_tool
    return None


def run_cmd(cmd: list[str], cwd: Path | None = None, check: bool = True) -> int:
    cmd_str = " ".join(f'"{arg}"' if " " in arg else arg for arg in cmd)
    print(f"\n[EXEC] {cmd_str}")
    proc = subprocess.run(cmd, cwd=cwd, check=False)
    if check and proc.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {proc.returncode}: {cmd_str}")
    return proc.returncode


def is_complete_image(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    try:
        with Image.open(path) as img:
            img.verify()
        return True
    except (OSError, ValueError):
        return False


def is_complete_ply(path: Path) -> bool:
    return path.is_file() and path.stat().st_size >= MIN_COMPLETE_PLY_BYTES


def ffconcat_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "'\\''")


def chunk_list(items: list, size: int) -> list[list]:
    if size < 1:
        size = 1
    return [items[i : i + size] for i in range(0, len(items), size)]


def natural_sort_key(path: Path) -> list[object]:
    import re
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", path.name)]


def detect_input_type(input_path: Path) -> Literal["video", "image", "ply", "folder_videos", "folder_images", "folder_plys", "folder_mixed", "unknown"]:
    if not input_path.exists():
        return "unknown"

    if input_path.is_file():
        ext = input_path.suffix.lower()
        if ext in VIDEO_EXTS:
            return "video"
        if ext in IMAGE_EXTS:
            return "image"
        if ext in PLY_EXTS:
            return "ply"
        return "unknown"

    if input_path.is_dir():
        images = [f for f in input_path.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTS]
        plys = [f for f in input_path.iterdir() if f.is_file() and f.suffix.lower() in PLY_EXTS]
        videos = [f for f in input_path.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_EXTS]

        if videos and not images and not plys:
            return "folder_videos"
        if plys and not images and not videos:
            return "folder_plys"
        if images and not plys and not videos:
            return "folder_images"
        if videos or images or plys:
            return "folder_mixed"
        return "unknown"

    return "unknown"


# ==========================================
# Pipeline Stages
# ==========================================

def stage_extract_video_frames(
    ffmpeg: str,
    input_video: Path,
    frames_dir: Path,
    fps: float = 30.0,
    start_seconds: float = 0.0,
    max_frames: int = 0,
    resume: bool = False,
    repair_from: int = 0,
) -> list[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(frames_dir.glob("frame_*.png"))

    if not resume or not existing:
        cmd = [ffmpeg, "-y"]
        if start_seconds > 0:
            cmd += ["-ss", str(start_seconds)]
        cmd += ["-i", str(input_video), "-vf", f"fps={fps}"]
        if max_frames > 0:
            cmd += ["-frames:v", str(max_frames)]
        cmd.append(str(frames_dir / "frame_%06d.png"))
        run_cmd(cmd)
    else:
        first_frame = repair_from
        if first_frame <= 0:
            highest = max(int(p.stem.rsplit("_", 1)[1]) for p in existing)
            first_frame = highest + 1
            for num in range(1, highest + 1):
                p = frames_dir / f"frame_{num:06d}.png"
                if not is_complete_image(p):
                    first_frame = num
                    break

        for p in frames_dir.glob("frame_*.png"):
            if int(p.stem.rsplit("_", 1)[1]) >= first_frame:
                p.unlink()

        existing_nums = [int(p.stem.rsplit("_", 1)[1]) for p in frames_dir.glob("frame_*.png")]
        if not existing_nums or first_frame <= max(existing_nums):
            actual_start_sec = start_seconds + (first_frame - 1) / fps
            cmd = [
                ffmpeg, "-y",
                "-ss", str(actual_start_sec),
                "-i", str(input_video),
                "-vf", f"fps={fps}",
                "-start_number", str(first_frame),
            ]
            if max_frames > 0:
                extracted_count = len(existing_nums)
                remaining = max_frames - extracted_count
                if remaining > 0:
                    cmd += ["-frames:v", str(remaining)]
            cmd.append(str(frames_dir / "frame_%06d.png"))
            run_cmd(cmd)

    return sorted(frames_dir.glob("frame_*.png"))


def stage_images_to_ply_batch(
    sharp_cli: Path,
    image_paths: list[Path],
    ply_dir: Path,
    device: str = "cuda",
    batch_size: int = 1000,
    resume: bool = False,
) -> list[Path]:
    ply_dir.mkdir(parents=True, exist_ok=True)
    if not image_paths:
        return sorted(ply_dir.glob("*.ply"))

    to_process: list[Path] = []
    for img in image_paths:
        target_ply = ply_dir / f"{img.stem}.ply"
        if resume and is_complete_ply(target_ply):
            continue
        to_process.append(img)

    if not to_process:
        print(f"[STAGE 2] All {len(image_paths)} PLYs exist. Skipping.")
        return sorted(ply_dir.glob("*.ply"))

    print(f"[STAGE 2] Generating {len(to_process)} PLYs in chunks of {batch_size}...")

    chunks = chunk_list(to_process, batch_size)
    for idx, chunk in enumerate(chunks, 1):
        print(f" -> Batch {idx}/{len(chunks)} ({len(chunk)} images)")
        temp_in = ply_dir / f".batch_in_{idx}"
        if temp_in.exists():
            shutil.rmtree(temp_in)
        temp_in.mkdir(parents=True, exist_ok=True)

        for p in chunk:
            target = temp_in / p.name
            try:
                os.link(p, target)
            except OSError:
                shutil.copy2(p, target)

        cmd = [
            str(sharp_cli),
            "predict",
            "-i", str(temp_in),
            "-o", str(ply_dir),
            "--device", device,
        ]
        run_cmd(cmd)
        shutil.rmtree(temp_in, ignore_errors=True)

    return sorted(ply_dir.glob("*.ply"))


def stage_render_stereo_frames_concurrent(
    sharp_cli: Path,
    ply_paths: list[Path],
    stereo_frames_dir: Path,
    ipd: float = 0.064,
    render_workers: int = 1,
    delete_ply_after_render: bool = False,
    resume: bool = False,
) -> list[Path]:
    stereo_frames_dir.mkdir(parents=True, exist_ok=True)
    temp_base = stereo_frames_dir / ".rendering"
    temp_base.mkdir(parents=True, exist_ok=True)

    def render_single_ply(ply_file: Path) -> Path:
        out_sbs = stereo_frames_dir / f"{ply_file.stem}.sbs.png"
        if resume and is_complete_image(out_sbs):
            if delete_ply_after_render and ply_file.is_file():
                ply_file.unlink()
            return out_sbs

        temp_dir = temp_base / ply_file.stem
        temp_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            str(sharp_cli),
            "render-stereo-frames",
            "-i", str(ply_file),
            "-o", str(temp_dir),
            "--ipd", str(ipd),
        ]
        run_cmd(cmd)

        rendered = list(temp_dir.glob("*.sbs.png"))
        if not rendered or not is_complete_image(rendered[0]):
            raise RuntimeError(f"Failed to render stereo frame for {ply_file}")

        shutil.move(str(rendered[0]), str(out_sbs))
        shutil.rmtree(temp_dir, ignore_errors=True)

        if delete_ply_after_render and ply_file.is_file():
            ply_file.unlink()

        return out_sbs

    results: list[Path] = []
    if render_workers > 1:
        print(f"[STAGE 3] Concurrent stereo rendering ({render_workers} workers)...")
        with ThreadPoolExecutor(max_workers=render_workers) as executor:
            pending: set[Future[Path]] = set()
            for p in ply_paths:
                future = executor.submit(render_single_ply, p)
                pending.add(future)
                if len(pending) >= render_workers * 2:
                    done, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for d in done:
                        results.append(d.result())
            for d in wait(pending)[0]:
                results.append(d.result())
    else:
        for p in ply_paths:
            results.append(render_single_ply(p))

    shutil.rmtree(temp_base, ignore_errors=True)
    return sorted(stereo_frames_dir.glob("*.sbs.png"))


def stage_chunked_video_vr_pipeline(
    sharp_cli: Path,
    frames_dir: Path,
    ply_dir: Path,
    stereo_frames_dir: Path,
    ipd: float = 0.064,
    ply_batch_size: int = 1000,
    render_workers: int = 1,
    delete_ply_after_render: bool = False,
    device: str = "cuda",
    resume: bool = False,
) -> list[Path]:
    image_paths = sorted(frames_dir.glob("frame_*.png"))
    chunks = chunk_list(image_paths, ply_batch_size)

    print(f"\n[PIPELINE] Processing {len(image_paths)} frames across {len(chunks)} chunks (Batch size: {ply_batch_size}, Workers: {render_workers})")

    for chunk_idx, image_batch in enumerate(chunks, 1):
        print(f"\n=== [Chunk {chunk_idx}/{len(chunks)}] Processing {len(image_batch)} frames ===")
        missing_ply_images: list[Path] = []
        for img in image_batch:
            sbs_out = stereo_frames_dir / f"{img.stem}.sbs.png"
            ply_out = ply_dir / f"{img.stem}.ply"
            if resume and is_complete_image(sbs_out):
                if delete_ply_after_render and ply_out.exists():
                    ply_out.unlink()
                continue
            if is_complete_ply(ply_out):
                continue
            missing_ply_images.append(img)

        if missing_ply_images:
            stage_images_to_ply_batch(
                sharp_cli,
                missing_ply_images,
                ply_dir,
                device=device,
                batch_size=ply_batch_size,
                resume=resume,
            )

        chunk_ply_paths = [ply_dir / f"{img.stem}.ply" for img in image_batch if (ply_dir / f"{img.stem}.ply").exists() or not (stereo_frames_dir / f"{img.stem}.sbs.png").exists()]
        stage_render_stereo_frames_concurrent(
            sharp_cli,
            chunk_ply_paths,
            stereo_frames_dir,
            ipd=ipd,
            render_workers=render_workers,
            delete_ply_after_render=delete_ply_after_render,
            resume=resume,
        )

    return sorted(stereo_frames_dir.glob("*.sbs.png"))


def stage_render_ply_trajectory_video(
    sharp_cli: Path,
    ply_path: Path,
    output_dir: Path,
    mode: Literal["mono", "stereo"] = "stereo",
    trajectory: str = "rotate_forward",
    duration_seconds: float = 4.0,
    fps: float = 30.0,
    ipd: float = 0.064,
    layout: str = "sbs",
    render_depth: bool = False,
    resume: bool = True,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)

    fsbs_name = output_dir / f"{ply_path.stem}_{trajectory}_{int(fps)}fps_3D_FSBS.mp4"
    expected_main = output_dir / f"{ply_path.stem}.mp4" if mode == "mono" else fsbs_name
    if resume and expected_main.is_file() and expected_main.stat().st_size > 1024:
        print(f"[RESUME] Video already exists, skipping 3D render: {expected_main.name}")
        return expected_main

    if mode == "stereo" and resume:
        legacy_sbs = output_dir / f"{ply_path.stem}.sbs.mp4"
        if legacy_sbs.is_file() and legacy_sbs.stat().st_size > 1024:
            legacy_sbs.replace(fsbs_name)
            return fsbs_name

    if mode == "mono":
        cmd = [
            str(sharp_cli),
            "render",
            "-i", str(ply_path),
            "-o", str(output_dir),
            "--trajectory", trajectory,
            "--duration-seconds", str(duration_seconds),
            "--fps", str(fps),
        ]
    else:
        cmd = [
            str(sharp_cli),
            "render-stereo",
            "-i", str(ply_path),
            "-o", str(output_dir),
            "--ipd", str(ipd),
            "--layout", layout,
            "--duration-seconds", str(duration_seconds),
            "--fps", str(fps),
            "--trajectory", trajectory,
        ]

    if render_depth:
        cmd.append("--render-depth")

    run_cmd(cmd)

    if mode == "stereo":
        sbs_cand = output_dir / f"{ply_path.stem}.sbs.mp4"
        if sbs_cand.is_file() and sbs_cand.stat().st_size > 0:
            sbs_cand.replace(fsbs_name)
            return fsbs_name

    # Filter out helper videos like .depth.mp4 or .alpha.mp4
    main_candidates = [
        output_dir / f"{ply_path.stem}.mp4",
        fsbs_name,
        output_dir / f"{ply_path.stem}.sbs.mp4",
    ]
    for cand in main_candidates:
        if cand.is_file() and cand.stat().st_size > 0:
            return cand

    valid_mp4s = [
        p for p in sorted(output_dir.glob("*.mp4"))
        if not p.name.endswith(".depth.mp4")
        and not p.name.endswith(".alpha.mp4")
        and not "_meural" in p.name
        and p.stat().st_size > 0
    ]
    if not valid_mp4s:
        raise RuntimeError(f"Valid rendered video not found in '{output_dir}'.")
    return valid_mp4s[0]


def build_frame_assembly_cmd(
    ffmpeg: str,
    concat_list: Path,
    output_video: Path,
    *,
    audio_source: Path | None = None,
    audio_start_seconds: float = 0.0,
    fps: float = 30.0,
    crf: int = 18,
    limit_quest3: bool = True,
    max_w: int = QUEST3_MAX_WIDTH,
    max_h: int = QUEST3_MAX_HEIGHT,
    video_codec: Literal["quest3_hevc", "h264"] = "quest3_hevc",
    hevc_encoder_key: str = "x265",
    hevc_quality: int = QUEST_APP_DEFAULT_QUALITY,
) -> list[str]:
    """Build ffmpeg command to assemble SBS frames into a Quest 3 HEVC or H.264 MP4."""
    cmd = [
        ffmpeg,
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(concat_list),
    ]
    if audio_source is not None:
        if audio_start_seconds > 0:
            cmd += ["-ss", str(audio_start_seconds)]
        cmd += ["-i", str(audio_source)]

    cmd += ["-map", "0:v:0"]
    if audio_source is not None:
        cmd += ["-map", "1:a?"]

    if video_codec == "quest3_hevc":
        vf_parts: list[str] = []
        if limit_quest3:
            eff_w = min(max_w, QUEST_APP_MAX_WIDTH)
            eff_h = min(max_h, QUEST_APP_MAX_HEIGHT)
            vf_parts.append(build_quest_app_scale_filter(max_w=eff_w, max_h=eff_h))
        if fps > QUEST_APP_MAX_FPS + 0.5:
            vf_parts.append(f"fps={QUEST_APP_MAX_FPS}")
        if vf_parts:
            cmd += ["-vf", ",".join(vf_parts)]

        codec, params = HEVC_ENCODERS[hevc_encoder_key]
        cmd += ["-c:v", codec]
        cmd += [part.format(q=hevc_quality) for part in params]
        cmd += [
            "-pix_fmt", "yuv420p",
            "-tag:v", "hvc1",
            "-metadata:s:v:0", "stereo_mode=left_right",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            str(output_video),
        ]
        return cmd

    if limit_quest3:
        cmd += ["-vf", build_quest3_scale_filter(max_w=max_w, max_h=max_h)]

    cmd += [
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", str(crf),
        "-x264opts", "frame-packing=3",
        "-metadata:s:v:0", "stereo_mode=left_right",
        "-c:a", "aac",
        "-shortest",
        "-movflags", "+faststart",
        str(output_video),
    ]
    return cmd


def stage_assemble_video_from_frames(
    ffmpeg: str,
    frames: list[Path],
    output_video: Path,
    audio_source: Path | None = None,
    audio_start_seconds: float = 0.0,
    fps: float = 30.0,
    crf: int = 18,
    limit_quest3: bool = True,
    max_w: int = QUEST3_MAX_WIDTH,
    max_h: int = QUEST3_MAX_HEIGHT,
    video_codec: Literal["quest3_hevc", "h264"] = "quest3_hevc",
    hevc_encoder: str = "auto",
    hevc_quality: int = QUEST_APP_DEFAULT_QUALITY,
) -> Path:
    output_video.parent.mkdir(parents=True, exist_ok=True)
    concat_list = output_video.parent / "frames_concat_list.txt"

    lines = ["ffconcat version 1.0"]
    for f in frames:
        lines.append(f"file '{ffconcat_path(f)}'")
        lines.append(f"duration {1.0 / fps:.6f}")
    if frames:
        lines.append(f"file '{ffconcat_path(frames[-1])}'")

    concat_list.write_text("\n".join(lines) + "\n", encoding="utf-8")

    try:
        if video_codec == "quest3_hevc":
            first = pick_hevc_encoder(ffmpeg, hevc_encoder)
            print(f"[QUEST3 VR ENCODE] {HEVC_ENCODERS[first][0]} (HEVC hvc1, <= {min(max_w, QUEST_APP_MAX_WIDTH)}x{min(max_h, QUEST_APP_MAX_HEIGHT)}, <= {QUEST_APP_MAX_FPS}fps)")
            attempts = [first] + (["x265"] if first != "x265" else [])
            last_error = ""
            for key in attempts:
                output_video.unlink(missing_ok=True)
                cmd = build_frame_assembly_cmd(
                    ffmpeg,
                    concat_list,
                    output_video,
                    audio_source=audio_source,
                    audio_start_seconds=audio_start_seconds,
                    fps=fps,
                    crf=crf,
                    limit_quest3=limit_quest3,
                    max_w=max_w,
                    max_h=max_h,
                    video_codec="quest3_hevc",
                    hevc_encoder_key=key,
                    hevc_quality=hevc_quality,
                )
                rc = run_cmd(cmd, check=False)
                if rc == 0 and output_video.is_file() and output_video.stat().st_size > 0:
                    break
                last_error = f"{HEVC_ENCODERS[key][0]} (exit {rc})"
                print(f"[WARN] Quest 3 HEVC 조립 실패: {last_error}. 폴백 인코더로 재시도합니다.")
            else:
                output_video.unlink(missing_ok=True)
                raise RuntimeError(f"Quest 3 HEVC 영상 조립에 실패했습니다: {output_video} ({last_error})")
        else:
            cmd = build_frame_assembly_cmd(
                ffmpeg,
                concat_list,
                output_video,
                audio_source=audio_source,
                audio_start_seconds=audio_start_seconds,
                fps=fps,
                crf=crf,
                limit_quest3=limit_quest3,
                max_w=max_w,
                max_h=max_h,
                video_codec="h264",
            )
            run_cmd(cmd)
    finally:
        concat_list.unlink(missing_ok=True)
    return output_video


def stage_inject_youtube_3d(
    input_sbs_video: Path,
    output_video: Path | None = None,
    format_type: Literal["fpa", "vr180"] = "fpa",
) -> Path:
    ffmpeg = get_ffmpeg_exe()
    if output_video is None:
        tag = "youtube3d_fpa" if format_type == "fpa" else "youtube_vr180_8k"
        output_video = input_sbs_video.parent / f"{input_sbs_video.stem}_{tag}.mp4"

    if format_type == "fpa":
        cmd = [
            ffmpeg,
            "-y",
            "-i", str(input_sbs_video),
            "-map", "0",
            "-c:v", "libx264",
            "-x264opts", "frame-packing=3",
            "-vf", "setsar=1/2",
            "-aspect", "16:9",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(output_video),
        ]
        run_cmd(cmd)
        return output_video

    elif format_type == "vr180":
        spatial_tool = get_spatial_media_tool()
        python_exe = get_python_exe()

        temp_canvas = input_sbs_video.parent / f"{input_sbs_video.stem}_canvas_preinject.mp4"
        filter_complex = (
            "[0:v]crop=3840:2160:0:0,pad=3840:4320:0:1080:black[left];"
            "[0:v]crop=3840:2160:3840:0,pad=3840:4320:0:1080:black[right];"
            "[left][right]hstack=inputs=2[v]"
        )
        cmd_canvas = [
            ffmpeg,
            "-y",
            "-i", str(input_sbs_video),
            "-filter_complex", filter_complex,
            "-map", "[v]",
            "-map", "0:a?",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-crf", "18",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(temp_canvas),
        ]
        run_cmd(cmd_canvas)

        if spatial_tool and Path(spatial_tool).exists():
            cmd_meta = [
                python_exe,
                str(spatial_tool),
                "-i", "-2",
                "-s", "left-right",
                "-p", "equirectangular",
                "-b", "0:0:1073741824:1073741824",
                str(temp_canvas),
                str(output_video),
            ]
            run_cmd(cmd_meta)
            temp_canvas.unlink(missing_ok=True)
        else:
            print("[WARN] Spatial media tool not found. Saving canvas without metadata.")
            temp_canvas.replace(output_video)

        return output_video

    return input_sbs_video


def get_media_dimensions(path: Path) -> tuple[int, int]:
    """Return (width, height) of an image or video file."""
    if path.suffix.lower() in IMAGE_EXTS:
        try:
            with Image.open(path) as img:
                return img.size
        except Exception:
            pass

    # Try ffprobe for video
    try:
        ffprobe = shutil.which("ffprobe") or r"C:\Program Files\ffmpeg\bin\ffprobe.exe"
        if Path(ffprobe).exists():
            res = subprocess.run(
                [str(ffprobe), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", str(path)],
                capture_output=True, text=True, check=True
            )
            w_str, h_str = res.stdout.strip().split("x")
            return int(w_str), int(h_str)
    except Exception:
        pass

    # Fallback: extract 1 frame with ffmpeg
    try:
        ffmpeg = get_ffmpeg_exe()
        temp_thumb = path.parent / f".dim_check_{path.stem}.png"
        subprocess.run([ffmpeg, "-y", "-i", str(path), "-vframes", "1", str(temp_thumb)], capture_output=True, check=True)
        if temp_thumb.is_file():
            with Image.open(temp_thumb) as img:
                w, h = img.size
            temp_thumb.unlink(missing_ok=True)
            return w, h
    except Exception:
        pass

    return 1920, 1080


def get_video_bitrate(path: Path) -> int | None:
    """Return the average bitrate in bits/sec for a video file."""
    if not path.is_file():
        return None

    import json
    ffprobe = shutil.which("ffprobe") or r"C:\Program Files\ffmpeg\bin\ffprobe.exe"
    if Path(ffprobe).exists():
        try:
            res = subprocess.run(
                [
                    str(ffprobe),
                    "-v", "error",
                    "-select_streams", "v:0",
                    "-show_entries", "stream=bit_rate",
                    "-show_entries", "format=bit_rate,duration",
                    "-of", "json",
                    str(path),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            data = json.loads(res.stdout)
            streams = data.get("streams", [])
            if streams and streams[0].get("bit_rate"):
                try:
                    return int(streams[0]["bit_rate"])
                except (ValueError, TypeError):
                    pass

            format_info = data.get("format", {})
            if format_info.get("bit_rate"):
                try:
                    return int(format_info["bit_rate"])
                except (ValueError, TypeError):
                    pass

            # Fallback: file_size * 8 / duration
            if format_info.get("duration"):
                dur = float(format_info["duration"])
                if dur > 0:
                    return int((path.stat().st_size * 8) / dur)
        except Exception:
            pass

    return None


def stage_export_meural_canvas(
    input_video: Path,
    output_video: Path | None = None,
    target_fps: float = 30.0,
    target_bitrate_mbps: int = 12,
    orientation: Literal["auto", "portrait", "landscape"] = "auto",
    reference_input: Path | None = None,
) -> Path:
    """
    Encode / Transcode video specifically for Netgear Meural Canvas II 27" (MC327):
    - MP4 container
    - H.264 (AVC) High Profile Level 4.1
    - Landscape: 1920x1080 (16:9)
    - Portrait:  1080x1920 (9:16)
    - 30 fps
    - 10-12 Mbps VBR (max 15M, bufsize 24M)
    - Mute audio (-an)
    - Faststart enabled
    """
    ffmpeg = get_ffmpeg_exe()
    ref_path = reference_input if (reference_input and reference_input.exists()) else input_video
    w, h = get_media_dimensions(ref_path)

    if orientation == "portrait":
        is_portrait = True
    elif orientation == "landscape":
        is_portrait = False
    else:
        # auto detect
        is_portrait = (h > w)

    target_w, target_h = (1080, 1920) if is_portrait else (1920, 1080)
    mode_tag = "portrait_1080x1920" if is_portrait else "landscape_1920x1080"

    if output_video is None:
        output_video = input_video.parent / f"{input_video.stem}_meural_{mode_tag}_30fps.mp4"

    filter_str = (
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
        f"crop={target_w}:{target_h},"
        "fps=30,"
        "format=yuv420p"
    )

    cmd = [
        ffmpeg,
        "-y",
        "-i", str(input_video),
        "-vf", filter_str,
        "-c:v", "libx264",
        "-profile:v", "high",
        "-level", "4.1",
        "-b:v", f"{target_bitrate_mbps}M",
        "-maxrate", f"{target_bitrate_mbps + 3}M",
        "-bufsize", f"{target_bitrate_mbps * 2}M",
        "-pix_fmt", "yuv420p",
        "-an",
        "-movflags", "+faststart",
        str(output_video),
    ]

    print(f"\n[MEURAL PRESET] Encoding Netgear Meural Canvas II ({target_w}x{target_h} {mode_tag}, 30fps, ~{target_bitrate_mbps}Mbps)...")
    run_cmd(cmd)
    return output_video


def stage_optimize_for_quest3(
    input_video: Path,
    output_video: Path | None = None,
    max_w: int = QUEST3_MAX_WIDTH,
    max_h: int = QUEST3_MAX_HEIGHT,
    crf: int = 19,
    codec: str = "libx264",
    bitrate_ratio: float = 1.1,
) -> Path:
    """
    Optimize or downscale an existing SBS (or 2D/3D) video for PC streaming players such as
    4XVR / 4XLink (up to 8192x4320 @ 60fps). Keeps H.264 by default, so the result can exceed the
    Quest browser's H.264 limit (4K): for the Quest app use stage_optimize_for_quest_app (--mode quest_app).
    Uses smart Constrained VBR based on original video bitrate (~110% target, 130% cap)
    to prevent file size inflation while preserving high visual quality.
    """
    ffmpeg = get_ffmpeg_exe()
    w, h = get_media_dimensions(input_video)

    if output_video is None:
        clean_stem = input_video.stem.replace("_3D_FSBS", "").replace("_FSBS", "").replace("_3DH_FSBS", "")
        output_video = input_video.parent / f"{clean_stem}_quest3_8k_3D_FSBS.mp4"

    print(f"\n[QUEST 3 OPTIMIZATION] Checking resolution for '{input_video.name}': {w}x{h}")
    print(f"Target maximum size: {max_w}x{max_h}")

    if w <= max_w and h <= max_h and (w % 2 == 0) and (h % 2 == 0):
        print(f"[INFO] Video resolution ({w}x{h}) is already within Quest 3 maximum limits ({max_w}x{max_h}).")
    else:
        print(f"[INFO] Video exceeds limit or has uneven dimensions. Downscaling/fixing to Quest 3 limit while preserving aspect ratio...")

    scale_filter = build_quest3_scale_filter(max_w=max_w, max_h=max_h)

    # Detect original bitrate for smart VBR capping
    orig_bitrate = get_video_bitrate(input_video)
    bitrate_args = []
    if orig_bitrate and orig_bitrate > 0:
        target_br = int(orig_bitrate * bitrate_ratio)
        max_br = int(target_br * 1.30)
        buf_br = int(target_br * 2.0)
        bitrate_args = [
            "-b:v", str(target_br),
            "-maxrate", str(max_br),
            "-bufsize", str(buf_br),
        ]
        print(f"[BITRATE CONTROL] 원본 평균: {orig_bitrate / 1_000_000:.2f} Mbps ➡️ 타겟: {target_br / 1_000_000:.2f} Mbps (피크 한도: {max_br / 1_000_000:.2f} Mbps, 비율: {bitrate_ratio*100:.0f}%)")
    else:
        print(f"[BITRATE CONTROL] 원본 비트레이트를 감지할 수 없어 기본 CRF {crf} 모드로 인코딩합니다.")

    cmd = [
        ffmpeg,
        "-y",
        "-i", str(input_video),
        "-vf", scale_filter,
        "-c:v", codec,
        "-pix_fmt", "yuv420p",
        "-crf", str(crf),
        "-x264opts", "frame-packing=3",
        "-metadata:s:v:0", "stereo_mode=left_right",
    ] + bitrate_args + [
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(output_video),
    ]

    run_cmd(cmd)
    out_w, out_h = get_media_dimensions(output_video)
    out_bitrate = get_video_bitrate(output_video)
    br_str = f", {out_bitrate / 1_000_000:.2f} Mbps" if out_bitrate else ""
    print(f"[SUCCESS] Quest 3 최적화 비디오 생성 완료: {output_video.name} ({out_w}x{out_h}{br_str})")
    if codec == "libx264" and max(out_w, out_h) > 4096:
        print("[TIP] 이 파일은 PC 스트리밍 플레이어(4XVR 등)용입니다. Quest 앱(브라우저)은 H.264 4K 초과를 재생하지 못하므로 앱에서 볼 영상은 --mode quest_app 으로 변환하세요.")
    return output_video


def build_quest_app_scale_filter(max_w: int = QUEST_APP_MAX_WIDTH, max_h: int = QUEST_APP_MAX_HEIGHT) -> str:
    """Scale down (never up) to fit max_w x max_h keeping the aspect ratio, with even dimensions."""
    return f"scale='min({max_w},iw)':'min({max_h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"


def get_video_fps(path: Path) -> float | None:
    """Return the video frame rate in fps, or None when it cannot be read."""
    ffprobe = shutil.which("ffprobe") or r"C:\Program Files\ffmpeg\bin\ffprobe.exe"
    try:
        res = subprocess.run(
            [str(ffprobe), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, check=True, timeout=30,
        )
        num, _, den = res.stdout.strip().partition("/")
        fps = float(num) / float(den or 1)
        return fps if fps > 0 else None
    except Exception:
        return None


# Audio codecs Quest Browser plays inside MP4, so the Quest-app conversion can keep them as they are (-c:a copy).
# Anything else (AC-3/E-AC-3, DTS, TrueHD, PCM, ...) plays silently in the app, so it is re-encoded to AAC.
QUEST_APP_COPY_AUDIO_CODECS = frozenset({"aac", "mp3"})


def probe_audio_codec(path: Path) -> str | None:
    """codec_name of the first audio stream (e.g. "aac", "ac3"), or None when there is no audio or ffprobe is unavailable."""
    ffprobe = shutil.which("ffprobe") or r"C:\Program Files\ffmpeg\bin\ffprobe.exe"
    try:
        result = subprocess.run(
            [str(ffprobe), "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    name = result.stdout.strip().splitlines()
    return name[0].strip().lower() if name and name[0].strip() else None


def choose_quest_app_audio(codec: str | None) -> str:
    """"copy" when the source audio is one Quest Browser plays (or there is none), otherwise "aac" (re-encode)."""
    if codec is None or codec in QUEST_APP_COPY_AUDIO_CODECS:
        return "copy"
    return "aac"


def build_quest_app_encode_cmd(
    ffmpeg: str,
    input_video: Path,
    output_video: Path,
    encoder_key: str,
    audio: str,
    scale_filter: str,
    quality: int = QUEST_APP_DEFAULT_QUALITY,
) -> list[str]:
    """ffmpeg command for the Quest app format: HEVC (hvc1 tag), 8-bit 4:2:0, faststart.

    audio is "copy" (keep the original stream) or "aac" (re-encode, used when copying fails).
    """
    codec, params = HEVC_ENCODERS[encoder_key]
    audio_args = ["-c:a", "copy"] if audio == "copy" else ["-c:a", "aac", "-b:a", "192k"]
    return (
        [ffmpeg, "-hide_banner", "-y", "-i", str(input_video), "-map", "0:v:0", "-map", "0:a:0?", "-vf", scale_filter, "-c:v", codec]
        + [part.format(q=quality) for part in params]
        + ["-pix_fmt", "yuv420p", "-tag:v", "hvc1"]
        + audio_args
        + ["-movflags", "+faststart", str(output_video)]
    )


def probe_hevc_encoder(ffmpeg: str, encoder_key: str, quality: int = QUEST_APP_DEFAULT_QUALITY) -> bool:
    """True when ffmpeg can really encode with this HEVC encoder on this machine (tiny test encode)."""
    codec, params = HEVC_ENCODERS[encoder_key]
    cmd = (
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=30:d=0.2", "-frames:v", "3", "-c:v", codec]
        + [part.format(q=quality) for part in params]
        + ["-pix_fmt", "yuv420p", "-f", "null", "-"]
    )
    try:
        return subprocess.run(cmd, capture_output=True, timeout=60).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def pick_hevc_encoder(ffmpeg: str, preference: str = "auto", probe=probe_hevc_encoder) -> str:
    """Choose the HEVC encoder key: the requested one if it works, otherwise the first working one (CPU libx265 last)."""
    candidates = HEVC_ENCODER_ORDER if preference == "auto" else [preference] + [k for k in HEVC_ENCODER_ORDER if k != preference]
    for key in candidates:
        if key == "x265" or probe(ffmpeg, key):
            if preference not in ("auto", key):
                print(f"[INFO] 요청한 인코더({preference})를 쓸 수 없어 {key}로 대신합니다.")
            return key
    return "x265"


def unique_output_path(path: Path) -> Path:
    """path가 이미 있으면 _2, _3 ... 을 붙인다(원본·기존 결과를 덮어쓰지 않는다)."""
    if not path.exists():
        return path
    index = 2
    while True:
        candidate = path.with_name(f"{path.stem}_{index}{path.suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def stage_optimize_for_quest_app(
    input_video: Path,
    output_video: Path | None = None,
    max_w: int = QUEST_APP_MAX_WIDTH,
    max_h: int = QUEST_APP_MAX_HEIGHT,
    quality: int = QUEST_APP_DEFAULT_QUALITY,
    encoder: str = "auto",
) -> Path:
    """
    Re-encode a video so the Quest 3 app (Quest Browser) can play it: HEVC (hvc1), faststart,
    at most 8192x4096 and 60fps. Same format as bat\\make_quest_app_video.bat. Uses a hardware encoder
    (NVENC / Quick Sync / AMF) when available and falls back to libx265. The input is never modified.
    Output: <name>_quest_hevc.mp4 next to the input (never overwrites an existing file).
    """
    ffmpeg = get_ffmpeg_exe()
    max_w = min(max_w, QUEST_APP_MAX_WIDTH)
    max_h = min(max_h, QUEST_APP_MAX_HEIGHT)
    w, h = get_media_dimensions(input_video)
    fps = get_video_fps(input_video)

    if output_video is None:
        output_video = unique_output_path(input_video.with_name(f"{input_video.stem}_quest_hevc.mp4"))

    scale_filter = build_quest_app_scale_filter(max_w, max_h)
    if fps and fps > QUEST_APP_MAX_FPS + 0.5:
        scale_filter += f",fps={QUEST_APP_MAX_FPS}"
        print(f"[INFO] {fps:.1f}fps 영상은 Quest 디코더 한계({QUEST_APP_MAX_FPS}fps)에 맞춰 {QUEST_APP_MAX_FPS}fps로 줄입니다.")

    print(f"\n[QUEST APP HEVC] '{input_video.name}': {w}x{h}" + (f" {fps:.2f}fps" if fps else "") + f" -> 최대 {max_w}x{max_h}, HEVC(hvc1)")
    first = pick_hevc_encoder(ffmpeg, encoder)
    print(f"[ENCODER] {HEVC_ENCODERS[first][0]}" + (" (GPU)" if first != "x265" else " (CPU, 느릴 수 있음)"))

    audio_codec = probe_audio_codec(input_video)
    audio_first = choose_quest_app_audio(audio_codec)
    if audio_codec is None:
        print("[AUDIO] 입력에 소리 트랙이 없습니다. 결과 영상에도 소리가 없습니다.")
    elif audio_first == "aac":
        print(f"[AUDIO] 소리 형식 {audio_codec}는 Quest 브라우저가 재생하지 못해 AAC로 다시 인코딩합니다.")
    attempts = [(first, audio_first)] + ([(first, "aac")] if audio_first == "copy" else [])
    if first != "x265":
        attempts.append(("x265", "aac"))
    last_error = ""
    for key, audio in attempts:
        output_video.unlink(missing_ok=True)
        cmd = build_quest_app_encode_cmd(ffmpeg, input_video, output_video, key, audio, scale_filter, quality)
        rc = run_cmd(cmd, check=False)
        if rc == 0 and output_video.is_file() and output_video.stat().st_size > 0:
            break
        last_error = f"{HEVC_ENCODERS[key][0]} / audio {audio} (exit {rc})"
        print(f"[WARN] 인코딩 실패: {last_error}. 다음 방법으로 다시 시도합니다.")
    else:
        output_video.unlink(missing_ok=True)
        raise RuntimeError(f"Quest 앱용 HEVC 변환에 실패했습니다: {input_video} (마지막 시도: {last_error})")

    out_w, out_h = get_media_dimensions(output_video)
    out_bitrate = get_video_bitrate(output_video)
    br_str = f", {out_bitrate / 1_000_000:.1f} Mbps" if out_bitrate else ""
    print(f"[SUCCESS] Quest 앱용 HEVC 영상 생성 완료: {output_video.name} ({out_w}x{out_h}{br_str})")
    return output_video


def stage_merge_folder_videos(
    input_folder: Path,
    output_path: Path | None = None,
) -> Path:
    """
    Concatenate all non-depth MP4/video files in a folder into a single video file in natural filename order.
    """
    ffmpeg = get_ffmpeg_exe()
    folder_resolved = input_folder.resolve()
    if output_path is None:
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = folder_resolved / f"sharp_merged_{stamp}.mp4"
    else:
        output_path = output_path.resolve()

    output_path.parent.mkdir(parents=True, exist_ok=True)

    videos = sorted(
        (
            p for p in folder_resolved.iterdir()
            if p.is_file()
            and p.suffix.lower() in VIDEO_EXTS
            and not p.name.lower().endswith(".depth.mp4")
            and not p.name.lower().endswith(".alpha.mp4")
            and not p.name.lower().startswith("sharp_merged_")
            and p.resolve() != output_path
        ),
        key=natural_sort_key,
    )

    if not videos:
        raise RuntimeError(f"No mergeable videos found in '{input_folder}'.")

    concat_list = folder_resolved / f".temp_concat_{dt.datetime.now().strftime('%H%M%S')}.txt"
    lines = ["ffconcat version 1.0"]
    for v in videos:
        lines.append(f"file '{ffconcat_path(v)}'")
    concat_list.write_text("\n".join(lines) + "\n", encoding="utf-8")

    cmd = [
        ffmpeg,
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(concat_list),
        "-c", "copy",
        "-movflags", "+faststart",
        str(output_path),
    ]

    print(f"\n[MERGE VIDEOS] Joining {len(videos)} videos in filename order into: {output_path.name}")
    try:
        run_cmd(cmd)
    finally:
        concat_list.unlink(missing_ok=True)

    print(f"[SUCCESS] Merged video created: {output_path}")
    return output_path


def stage_batch_process_videos(
    folder_path: Path,
    target_mode: str,
    args: argparse.Namespace,
    base_output_dir: Path,
) -> list[Path]:
    """
    Process all videos in a folder in batch according to the target mode:
    - optimize_quest3 / resize_quest3: Optimize/resize each video for PC streaming players (4XVR etc.)
    - quest_app: Re-encode each video to HEVC for the Quest 3 app (Quest Browser)
    - video_vr / batch_video_vr: Run full Video-to-VR SBS pipeline for each video
    - meural: Export each video for Netgear Meural Canvas II
    - youtube_3d: Inject YouTube 3D metadata for each video
    """
    videos = sorted(
        (
            p for p in folder_path.iterdir()
            if p.is_file()
            and p.suffix.lower() in VIDEO_EXTS
            and not p.name.lower().endswith(".depth.mp4")
            and not p.name.lower().endswith(".alpha.mp4")
            and not "_quest3_8k" in p.name.lower()
            and not "_quest_hevc" in p.name.lower()
            and not "_meural" in p.name.lower()
            and not p.name.lower().startswith("sharp_merged_")
        ),
        key=natural_sort_key,
    )

    if not videos:
        raise RuntimeError(f"No video files found in folder: {folder_path}")

    total = len(videos)
    print(f"\n[BATCH VIDEOS] Found {total} video(s) in folder: {folder_path.name}")
    print(f"Target Mode: {target_mode}")

    results: list[Path] = []
    for idx, vid in enumerate(videos, 1):
        pct = (idx / total) * 100
        print(f"\n{'='*60}")
        print(f" [BATCH {idx}/{total} ({pct:.1f}%)] Processing: {vid.name}")
        print(f"{'='*60}")

        if target_mode in ("optimize_quest3", "resize_quest3"):
            clean_stem = vid.stem.replace("_3D_FSBS", "").replace("_FSBS", "").replace("_3DH_FSBS", "")
            out_vid = base_output_dir / f"{clean_stem}_quest3_8k_3D_FSBS.mp4"
            res = stage_optimize_for_quest3(
                vid,
                output_video=out_vid,
                max_w=args.max_width,
                max_h=args.max_height,
                crf=args.crf,
                bitrate_ratio=args.bitrate_ratio,
            )
            results.append(res)
        elif target_mode == "quest_app":
            res = stage_optimize_for_quest_app(
                vid,
                output_video=unique_output_path(base_output_dir / f"{vid.stem}_quest_hevc.mp4"),
                max_w=args.max_width,
                max_h=args.max_height,
                quality=args.hevc_quality,
                encoder=args.hevc_encoder,
            )
            results.append(res)
        elif target_mode == "meural":
            out_vid = base_output_dir / f"{vid.stem}_meural_1080p30.mp4"
            res = stage_export_meural_canvas(
                vid,
                output_video=out_vid,
                orientation=args.meural_orientation,
                reference_input=vid,
            )
            results.append(res)
        elif target_mode == "youtube_3d":
            res = stage_inject_youtube_3d(vid, format_type=args.yt_format if args.yt_format != "none" else "fpa")
            results.append(res)
        elif target_mode in ("video_vr", "batch_video_vr", "auto"):
            item_out_dir = base_output_dir / f"vr_{vid.stem}"
            item_out_dir.mkdir(parents=True, exist_ok=True)
            frames_dir = item_out_dir / "01_frames"
            ply_dir = item_out_dir / "02_ply"
            stereo_dir = item_out_dir / "03_stereo_frames"
            final_mp4 = item_out_dir / f"{vid.stem}_vr_sbs_{int(args.fps)}fps_3D_FSBS.mp4"

            ffmpeg = get_ffmpeg_exe()
            sharp_cli = get_sharp_cli()

            frames = stage_extract_video_frames(
                ffmpeg, vid, frames_dir,
                fps=args.fps, start_seconds=args.start_seconds,
                max_frames=args.max_frames, resume=args.resume,
            )
            sbs_frames = stage_chunked_video_vr_pipeline(
                sharp_cli=sharp_cli,
                frames_dir=frames_dir,
                ply_dir=ply_dir,
                stereo_frames_dir=stereo_dir,
                ipd=args.ipd,
                ply_batch_size=args.ply_batch_size,
                render_workers=args.render_workers,
                delete_ply_after_render=args.clean_ply,
                device=args.device,
                resume=args.resume,
            )
            effective_codec = "h264" if args.yt_format != "none" else args.video_codec
            res_video = stage_assemble_video_from_frames(
                ffmpeg, sbs_frames, final_mp4,
                audio_source=vid,
                audio_start_seconds=args.start_seconds,
                fps=args.fps, crf=args.crf,
                limit_quest3=args.limit_quest3,
                max_w=args.max_width,
                max_h=args.max_height,
                video_codec=effective_codec,
                hevc_encoder=args.hevc_encoder,
                hevc_quality=args.hevc_quality,
            )
            if args.yt_format != "none":
                res_video = stage_inject_youtube_3d(res_video, format_type=args.yt_format)
            results.append(res_video)

    print(f"\n[BATCH COMPLETE] Processed {len(results)}/{total} video(s) successfully.")
    return results


# ==========================================
# Main Execution Orchestrator
# ==========================================

def run_quest_app_mode(args: argparse.Namespace, input_path: Path) -> None:
    """--mode quest_app: ffmpeg만 쓰므로 SHARP CLI 없이 동작하고 빈 outputs/run_* 폴더도 만들지 않는다.

    파일: 원본 옆에 <이름>_quest_hevc.mp4 (-o가 영상 파일이면 그 경로, 폴더면 그 폴더).
    폴더: 폴더 안의 모든 영상을 변환해 같은 폴더(-o가 있으면 그 폴더)에 둔다.
    """
    if input_path.is_dir():
        out_dir = args.output.resolve() if args.output else input_path
        out_dir.mkdir(parents=True, exist_ok=True)
        results = stage_batch_process_videos(input_path, target_mode="quest_app", args=args, base_output_dir=out_dir)
        print(f"\n[SUCCESS] 폴더 내 {len(results)}개 비디오 Quest 앱용 HEVC 변환 완료: {out_dir}")
        return

    target_out = None
    if args.output:
        out = args.output.resolve()
        if out.suffix.lower() in VIDEO_EXTS:
            target_out = out
        else:
            out.mkdir(parents=True, exist_ok=True)
            target_out = unique_output_path(out / f"{input_path.stem}_quest_hevc.mp4")
    app_vid = stage_optimize_for_quest_app(
        input_path,
        output_video=target_out,
        max_w=args.max_width,
        max_h=args.max_height,
        quality=args.hevc_quality,
        encoder=args.hevc_encoder,
    )
    print(f"\n[SUCCESS] Quest 앱용 HEVC 영상 생성 완료: {app_vid}")


def run_master_pipeline(args: argparse.Namespace) -> None:
    project_root = get_project_root()
    input_path: Path = args.input.resolve()

    if not input_path.exists():
        raise FileNotFoundError(f"Input path does not exist: {input_path}")

    if args.mode == "quest_app":
        run_quest_app_mode(args, input_path)
        return

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    if args.output:
        out_dir = args.output.resolve()
    else:
        out_dir = project_root / "outputs" / f"run_{stamp}_{input_path.stem}"

    out_dir.mkdir(parents=True, exist_ok=True)

    input_type = detect_input_type(input_path)
    is_meural = args.meural or args.preset == "meural"

    print("=" * 60)
    print(" SHARP Gaussian Splatting VR Master Pipeline")
    print("=" * 60)
    print(f"Input:          {input_path} (Detected: {input_type})")
    print(f"Output:         {out_dir}")
    print(f"Target Mode:    {args.mode}")
    print(f"Preset:         {'Netgear Meural Canvas II (MC327)' if is_meural else 'Default'}")
    print(f"FPS:            {args.fps}")
    print(f"Trajectory:     {args.trajectory}")
    print(f"Duration/PLY:   {args.duration}s")
    print(f"IPD:            {args.ipd}")
    print(f"Render Workers: {args.render_workers}")
    print(f"PLY Batch Size: {args.ply_batch_size}")
    print(f"Clean PLY:      {args.clean_ply}")
    print(f"Resume:         {args.resume}")
    print("=" * 60)

    sharp_cli = get_sharp_cli()
    ffmpeg = get_ffmpeg_exe()

    mode = args.mode

    # Specialized Target Modes
    if mode in ("merge_videos", "concat"):
        target_out = args.output if (args.output and args.output.suffix.lower() in VIDEO_EXTS) else None
        merged_vid = stage_merge_folder_videos(input_path, output_path=target_out)
        print(f"\n[SUCCESS] 폴더 비디오 병합 완료: {merged_vid}")
        return

    # Folder-wide batch video processing
    if input_path.is_dir():
        if mode in ("optimize_quest3", "resize_quest3"):
            res_vids = stage_batch_process_videos(input_path, target_mode=mode, args=args, base_output_dir=out_dir)
            print(f"\n[SUCCESS] 폴더 내 {len(res_vids)}개 비디오 Quest 3 최적화 완료.")
            return

        if mode in ("batch_video_vr",) or (mode == "video_vr" and input_type in ("folder_videos", "folder_mixed")):
            res_vids = stage_batch_process_videos(input_path, target_mode="video_vr", args=args, base_output_dir=out_dir)
            print(f"\n[SUCCESS] 폴더 내 {len(res_vids)}개 비디오 VR SBS 변환 완료.")
            return

        if mode == "auto" and input_type == "folder_videos":
            res_vids = stage_batch_process_videos(input_path, target_mode="video_vr", args=args, base_output_dir=out_dir)
            print(f"\n[SUCCESS] 폴더 내 {len(res_vids)}개 비디오 자동 VR SBS 변환 완료.")
            return

    if mode in ("optimize_quest3", "resize_quest3"):
        target_out = args.output if (args.output and args.output.suffix.lower() in VIDEO_EXTS) else None
        opt_vid = stage_optimize_for_quest3(
            input_path,
            output_video=target_out,
            max_w=args.max_width,
            max_h=args.max_height,
            crf=args.crf,
            bitrate_ratio=args.bitrate_ratio,
        )
        print(f"\n[SUCCESS] Meta Quest 3 최적화 영상 생성 완료: {opt_vid}")
        return

    if mode == "youtube_3d":
        yt_out = stage_inject_youtube_3d(input_path, format_type=args.yt_format if args.yt_format != "none" else "fpa")
        print(f"\n[SUCCESS] YouTube 3D Video generated: {yt_out}")
        return

    if mode == "meural":
        meural_out = stage_export_meural_canvas(
            input_path,
            orientation=args.meural_orientation,
            reference_input=input_path,
        )
        print(f"\n[SUCCESS] Meural Video generated: {meural_out}")
        return

    # Case A: Input is Video
    if input_type == "video":
        if is_meural and mode in ("auto", "video_mono"):
            # Direct export to Meural Canvas or extract 3D loop
            meural_vid = stage_export_meural_canvas(input_path, out_dir / f"{input_path.stem}_meural_1080p30.mp4")
            print(f"\n[SUCCESS] Exported Meural Canvas Video: {meural_vid}")
            return

        if mode in ("auto", "video_vr", "video_stereo"):
            frames_dir = out_dir / "01_frames"
            ply_dir = out_dir / "02_ply"
            stereo_dir = out_dir / "03_stereo_frames"
            final_mp4 = out_dir / f"{input_path.stem}_vr_sbs_{int(args.fps)}fps_3D_FSBS.mp4"

            # 1. Frames extraction
            frames = stage_extract_video_frames(
                ffmpeg, input_path, frames_dir,
                fps=args.fps, start_seconds=args.start_seconds,
                max_frames=args.max_frames, resume=args.resume,
                repair_from=args.repair_frames_from,
            )

            # 2 & 3. Chunked PLY generation & Concurrent SBS Rendering
            sbs_frames = stage_chunked_video_vr_pipeline(
                sharp_cli=sharp_cli,
                frames_dir=frames_dir,
                ply_dir=ply_dir,
                stereo_frames_dir=stereo_dir,
                ipd=args.ipd,
                ply_batch_size=args.ply_batch_size,
                render_workers=args.render_workers,
                delete_ply_after_render=args.clean_ply,
                device=args.device,
                resume=args.resume,
            )

            # 4. Assemble Video
            effective_codec = "h264" if args.yt_format != "none" else args.video_codec
            res_video = stage_assemble_video_from_frames(
                ffmpeg, sbs_frames, final_mp4,
                audio_source=input_path,
                audio_start_seconds=args.start_seconds,
                fps=args.fps, crf=args.crf,
                limit_quest3=args.limit_quest3,
                max_w=args.max_width,
                max_h=args.max_height,
                video_codec=effective_codec,
                hevc_encoder=args.hevc_encoder,
                hevc_quality=args.hevc_quality,
            )

            if args.yt_format != "none":
                res_video = stage_inject_youtube_3d(res_video, format_type=args.yt_format)

            print(f"\n[SUCCESS] Video VR Pipeline Completed: {res_video}")

        elif mode == "ply_only":
            frames_dir = out_dir / "01_frames"
            ply_dir = out_dir / "02_ply"
            frames = stage_extract_video_frames(
                ffmpeg, input_path, frames_dir,
                fps=args.fps, start_seconds=args.start_seconds,
                max_frames=args.max_frames, resume=args.resume,
            )
            plys = stage_images_to_ply_batch(
                sharp_cli, frames, ply_dir,
                device=args.device,
                batch_size=args.ply_batch_size,
                resume=args.resume,
            )
            print(f"\n[SUCCESS] Extracted {len(plys)} PLY files in: {ply_dir}")

    # Case B: Input is Single Image or Image Folder
    elif input_type in ("image", "folder_images"):
        img_list = [input_path] if input_type == "image" else sorted(
            [p for p in input_path.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS],
            key=natural_sort_key,
        )

        ply_dir = out_dir / "ply"
        plys = stage_images_to_ply_batch(
            sharp_cli, img_list, ply_dir,
            device=args.device,
            batch_size=args.ply_batch_size,
            resume=args.resume,
        )

        if mode == "sbs_image":
            sbs_dir = out_dir if out_dir.name == "sbs_images" else out_dir / "sbs_images"
            sbs_images = stage_render_stereo_frames_concurrent(
                sharp_cli,
                plys,
                sbs_dir,
                ipd=args.ipd,
                render_workers=args.render_workers,
                delete_ply_after_render=args.clean_ply,
                resume=args.resume,
            )
            print(f"\n[SUCCESS] Generated {len(sbs_images)} SBS stereo image(s) in: {sbs_dir}")
        elif is_meural or mode in ("auto", "video_stereo", "video_mono", "meural"):
            render_mode = "mono" if (is_meural or mode in ("video_mono", "meural")) else "stereo"
            video_out_dir = out_dir if out_dir.name == "rendered_videos" else out_dir / "rendered_videos"
            target_duration = 15.0 if (is_meural and args.duration == 4.0) else args.duration
            total_items = len(plys)

            for idx, (ply_file, src_img) in enumerate(zip(plys, img_list), start=1):
                pct = (idx / total_items) * 100
                print(f"\n[{idx}/{total_items} ({pct:.1f}%)] 3D 렌더링 진행 중: {ply_file.name}")

                vid = stage_render_ply_trajectory_video(
                    sharp_cli, ply_file, video_out_dir,
                    mode=render_mode, trajectory=args.trajectory,
                    duration_seconds=target_duration, fps=30.0 if is_meural else args.fps,
                    ipd=args.ipd,
                    render_depth=args.render_depth,
                    resume=args.resume,
                )
                if is_meural:
                    stage_export_meural_canvas(
                        vid,
                        orientation=args.meural_orientation,
                        reference_input=src_img,
                    )
                else:
                    if args.limit_quest3:
                        vw, vh = get_media_dimensions(vid)
                        if vw > args.max_width or vh > args.max_height:
                            vid = stage_optimize_for_quest3(
                                vid,
                                max_w=args.max_width,
                                max_h=args.max_height,
                                crf=args.crf,
                                bitrate_ratio=args.bitrate_ratio,
                            )
                    if args.yt_format != "none" and render_mode == "stereo":
                        stage_inject_youtube_3d(vid, format_type=args.yt_format)

            print(f"\n[SUCCESS] Rendered trajectory video(s) in: {video_out_dir}")
        else:
            print(f"\n[SUCCESS] Generated PLY(s) in: {ply_dir}")

    # Case C: Input is Single PLY or PLY Folder
    elif input_type in ("ply", "folder_plys"):
        ply_list = [input_path] if input_type == "ply" else sorted(
            [p for p in input_path.iterdir() if p.is_file() and p.suffix.lower() in PLY_EXTS],
            key=natural_sort_key,
        )

        if mode == "sbs_image":
            sbs_dir = out_dir if out_dir.name == "sbs_images" else out_dir / "sbs_images"
            sbs_images = stage_render_stereo_frames_concurrent(
                sharp_cli,
                ply_list,
                sbs_dir,
                ipd=args.ipd,
                render_workers=args.render_workers,
                delete_ply_after_render=False,
                resume=args.resume,
            )
            print(f"\n[SUCCESS] Generated {len(sbs_images)} SBS stereo image(s) in: {sbs_dir}")
            return

        render_mode = "mono" if (is_meural or mode in ("video_mono", "meural") or (mode == "auto" and not args.stereo)) else "stereo"
        video_out_dir = out_dir if out_dir.name == "rendered_videos" else out_dir / "rendered_videos"
        target_duration = 15.0 if (is_meural and args.duration == 4.0) else args.duration
        total_items = len(ply_list)

        for idx, ply_file in enumerate(ply_list, start=1):
            pct = (idx / total_items) * 100
            print(f"\n[{idx}/{total_items} ({pct:.1f}%)] 3D 렌더링 진행 중: {ply_file.name}")

            vid = stage_render_ply_trajectory_video(
                sharp_cli, ply_file, video_out_dir,
                mode=render_mode, trajectory=args.trajectory,
                duration_seconds=target_duration, fps=30.0 if is_meural else args.fps,
                ipd=args.ipd,
                render_depth=args.render_depth,
                resume=args.resume,
            )
            if is_meural:
                stage_export_meural_canvas(
                    vid,
                    orientation=args.meural_orientation,
                    reference_input=ply_file,
                )
            else:
                if args.limit_quest3:
                    vw, vh = get_media_dimensions(vid)
                    if vw > args.max_width or vh > args.max_height:
                        vid = stage_optimize_for_quest3(
                            vid,
                            max_w=args.max_width,
                            max_h=args.max_height,
                            crf=args.crf,
                            bitrate_ratio=args.bitrate_ratio,
                        )
                if args.yt_format != "none" and render_mode == "stereo":
                    stage_inject_youtube_3d(vid, format_type=args.yt_format)

        print(f"\n[SUCCESS] Rendered PLY video(s) in: {video_out_dir}")

    # Case D: YouTube 3D injection on SBS MP4
    elif mode == "youtube_3d":
        yt_out = stage_inject_youtube_3d(input_path, format_type=args.yt_format if args.yt_format != "none" else "fpa")
        print(f"\n[SUCCESS] YouTube 3D Video generated: {yt_out}")

    elif mode == "meural":
        meural_out = stage_export_meural_canvas(
            input_path,
            orientation=args.meural_orientation,
            reference_input=input_path,
        )
        print(f"\n[SUCCESS] Meural Video generated: {meural_out}")

    else:
        raise ValueError(f"Unsupported input type '{input_type}' for mode '{mode}'.")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Unified SHARP Gaussian Splatting VR Master Pipeline",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("-i", "--input", required=True, type=Path, help="Input video, image, ply, or folder")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output destination folder")
    parser.add_argument(
        "--mode",
        choices=[
            "auto", "ply_only", "sbs_image", "video_mono", "video_stereo", "video_vr",
            "youtube_3d", "meural", "optimize_quest3", "resize_quest3", "quest_app",
            "batch_video_vr", "merge_videos",
        ],
        default="auto",
        help=(
            "Target pipeline execution mode. optimize_quest3/resize_quest3 = H.264 resize for PC streaming players (4XVR etc.); "
            "quest_app = HEVC re-encode for the Quest 3 app (Quest Browser, hvc1, faststart, <= 8192x4096)"
        ),
    )
    parser.add_argument(
        "--preset",
        choices=["default", "meural"],
        default="default",
        help="Target display/device optimization preset",
    )
    parser.add_argument("--meural", action="store_true", help="Shortcut for Netgear Meural Canvas II 27' (H.264 30fps)")
    parser.add_argument(
        "--meural-orientation",
        choices=["auto", "portrait", "landscape"],
        default="auto",
        help="Screen orientation for Meural Canvas (auto detects 1080x1920 portrait or 1920x1080 landscape)",
    )
    parser.add_argument("--fps", type=float, default=30.0, help="Output frame rate (e.g. 30, 60)")
    parser.add_argument(
        "--render-depth",
        action="store_true",
        help="Also render and save auxiliary depth video (*.depth.mp4)",
    )
    parser.add_argument(
        "--trajectory",
        choices=["rotate_forward", "rotate", "swipe", "shake", "static"],
        default="rotate_forward",
        help="Camera trajectory for single image/PLY 3D rendering",
    )
    parser.add_argument("--duration", type=float, default=4.0, help="Render duration in seconds per PLY")
    parser.add_argument("--ipd", type=float, default=0.064, help="Interpupillary distance in meters (e.g. 0.064)")
    parser.add_argument("--crf", type=int, default=18, help="H.264 CRF video quality (lower is higher quality)")
    parser.add_argument(
        "--yt-format",
        choices=["none", "fpa", "vr180"],
        default="none",
        help="YouTube 3D metadata injection format",
    )
    parser.add_argument("--stereo", action="store_true", default=True, help="Render stereo 3D SBS")
    parser.add_argument("--mono", dest="stereo", action="store_false", help="Render mono 2D")
    parser.add_argument("--resume", action="store_true", help="Resume and skip existing completed frames/PLYs")
    parser.add_argument("--clean-ply", action="store_true", help="Delete intermediate PLYs after rendering to save disk")
    parser.add_argument(
        "--render-workers",
        "--workers",
        dest="render_workers",
        type=int,
        default=1,
        help="Number of concurrent SBS render workers (default: 1)",
    )
    parser.add_argument(
        "--ply-batch-size",
        "--batch-size",
        dest="ply_batch_size",
        type=int,
        default=1000,
        help="Number of PNG frames to infer before SBS render-and-delete stage (default: 1000)",
    )
    parser.add_argument("--device", type=str, default="cuda", help="PyTorch compute device ('cuda' or 'cpu')")
    parser.add_argument("--start-seconds", type=float, default=0.0, help="Start video extraction from timestamp (sec)")
    parser.add_argument("--max-frames", type=int, default=0, help="Max video frames to process (0 = all)")
    parser.add_argument("--repair-frames-from", type=int, default=0, help="Re-extract video frames from frame number")
    parser.add_argument(
        "--limit-quest3",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Enforce 4XVR/4XLink-class playback limits (max 8192x4320, H.264) for generated SBS videos. Not for the Quest app: use --mode quest_app",
    )
    parser.add_argument(
        "--max-width",
        type=int,
        default=QUEST3_MAX_WIDTH,
        help=f"Maximum video width limit for Quest 3 (default: {QUEST3_MAX_WIDTH})",
    )
    parser.add_argument(
        "--max-height",
        type=int,
        default=QUEST3_MAX_HEIGHT,
        help=f"Maximum video height limit for Quest 3 (default: {QUEST3_MAX_HEIGHT})",
    )
    parser.add_argument(
        "--bitrate-ratio",
        type=float,
        default=1.1,
        help="Target bitrate multiplier relative to original video (default: 1.1 for ~110%% of original bitrate)",
    )
    parser.add_argument(
        "--video-codec",
        choices=["quest3_hevc", "h264"],
        default="quest3_hevc",
        help="Video codec for full VR SBS assembly (quest3_hevc = HEVC hvc1 <=8192x4096@60fps for Quest 3; h264 = libx264 <=8192x4320 for 4XVR)",
    )
    parser.add_argument(
        "--hevc-encoder",
        choices=["auto", "nvenc", "qsv", "amf", "x265"],
        default="auto",
        help="HEVC encoder for --mode quest_app (auto = first working hardware encoder, else CPU libx265)",
    )
    parser.add_argument(
        "--hevc-quality",
        type=int,
        default=QUEST_APP_DEFAULT_QUALITY,
        help="Quality (CQ/CRF) for --mode quest_app; lower is higher quality",
    )

    return parser.parse_args()


if __name__ == "__main__":
    import traceback

    try:
        args = parse_arguments()
        run_master_pipeline(args)
        print("\n[COMPLETE] 모든 작업이 성공적으로 완료되었습니다.")
    except Exception as exc:
        print("\n" + "=" * 60, file=sys.stderr)
        print(f"[ERROR] Pipeline execution failed: {exc}", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        traceback.print_exc()
        # Pause if running in interactive console
        if sys.stdin and sys.stdin.isatty():
            try:
                input("\n[Enter를 누르면 창이 닫힙니다]...")
            except Exception:
                pass
        sys.exit(1)
