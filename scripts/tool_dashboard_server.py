from __future__ import annotations

import argparse
import json
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import webbrowser
from dataclasses import asdict, dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_HTML = PROJECT_ROOT / "tool_dashboard.html"


@dataclass(frozen=True)
class Tool:
    id: str
    title: str
    bat: str
    category: str
    input_mode: str
    input_label: str
    summary: str
    result: str
    caution: str
    file_kind: str = "file"
    extensions: tuple[str, ...] = ()
    workflow: str = ""
    default_duration: float = 2.0


TOOLS = [
    Tool(
        id="run_pipeline",
        title="통합 마스터 파이프라인 (추천)",
        bat="run_pipeline.bat",
        category="통합 실행",
        input_mode="file_or_folder_optional",
        input_label="원클릭 / 드래그 지원",
        summary="영상/이미지/PLY 어디서든 원하는 출력(PLY, 3D SBS, YouTube 3D)까지 옵션을 설정해 한번에 실행하는 통합 도구입니다.",
        result="지정한 모드와 옵션(FPS, 궤적, 시간 등)에 따라 outputs 폴더에 3D Splat 및 렌더링 결과물을 자동 생성합니다.",
        caution="더블클릭 시 메뉴 대화창이 뜨며, 파일/폴더를 드래그 앤 드롭하면 자동 감지 처리됩니다.",
        file_kind="both",
        extensions=(".jpg", ".jpeg", ".png", ".webp", ".bmp", ".ply", ".mp4", ".mov", ".avi", ".mkv"),
        workflow="0",
    ),
    Tool(
        id="export_meural",
        title="뮤럴 액자 (Meural Canvas 27\") 최적화 변환",
        bat="run_pipeline.bat",
        category="디스플레이 프리셋",
        input_mode="file_or_folder_required",
        input_label="파일/폴더 필요",
        summary="넷기어 뮤럴 캔버스 II 27인치(MC327) 규격에 맞춘 1080p 30fps H.264 High@L4.1 무음 비디오를 출력합니다.",
        result="하드웨어 버벅임 없는 1920x1080 30fps VBR 12Mbps 최적화 MP4 생성.",
        caution="영상/이미지/PLY 모두 지원하며, 이미지나 PLY는 15초 궤적 루프 영상으로 자동 생성됩니다.",
        file_kind="both",
        extensions=(".jpg", ".jpeg", ".png", ".webp", ".bmp", ".ply", ".mp4", ".mov", ".avi", ".mkv"),
        workflow="4",
    ),
    Tool(
        id="batch_quest3_optimize",
        title="폴더 내 SBS 동영상 일괄 Quest 3 (8K) 최적화",
        bat="resize_for_quest3.bat",
        category="디스플레이 프리셋",
        input_mode="folder_required",
        input_label="폴더 필요",
        summary="폴더 안의 모든 SBS 동영상을 메타 퀘스트 3 최대 하드웨어 한계(8192x4320 60fps) 이하로 일괄 리사이즈합니다.",
        result="선택 폴더에 원본 파일마다 [파일명]_quest3_8k.mp4 최적화 영상이 생성됩니다.",
        caution="4XVR / 4XLink에서 끊김 없는 고화질 재생을 위해 비율 왜곡 없이 8K 이내로 자동 비례 축소합니다.",
        file_kind="folder",
        extensions=(".mp4", ".mov", ".mkv", ".avi", ".webm"),
        workflow="4",
    ),
    Tool(
        id="batch_video_vr",
        title="폴더 내 동영상 일괄 VR 3D SBS 변환",
        bat="run_pipeline.bat",
        category="영상 파이프라인",
        input_mode="folder_required",
        input_label="폴더 필요",
        summary="지정한 폴더 내의 모든 동영상을 순서대로 VR 3D SBS 파이프라인으로 일괄 변환합니다.",
        result="outputs 폴더에 각 동영상 이름별 하위 폴더가 생성되며 최종 SBS 영상이 완성됩니다.",
        caution="여러 영상을 연속 변환하므로 GPU 부하와 처리 시간이 오래 걸릴 수 있습니다.",
        file_kind="folder",
        extensions=(".mp4", ".mov", ".mkv", ".avi", ".webm"),
        workflow="4",
    ),
    Tool(
        id="check_env",
        title="환경 확인",
        bat="check_env.bat",
        category="준비",
        input_mode="none",
        input_label="더블클릭형",
        summary="Python, PyTorch, CUDA, GPU, SHARP CLI 상태를 빠르게 확인합니다.",
        result="콘솔에 현재 실행 환경과 CUDA 인식 상태를 출력합니다.",
        caution="문제가 생겼을 때 가장 먼저 실행하는 진단 도구입니다.",
        workflow="1",
    ),
    Tool(
        id="setup_environment",
        title="환경 셋팅",
        bat="run_setup_environment.bat",
        category="준비",
        input_mode="none",
        input_label="더블클릭형",
        summary="처음 쓰는 PC에서 Git, Python, Node, ffmpeg, CUDA/Build Tools 상태를 확인하고 프로젝트 환경을 준비합니다.",
        result=".venv 생성, SHARP 의존성 설치, 서브모듈 갱신, stereo 패치 적용, WebXR npm 패키지 설치를 순서대로 진행합니다.",
        caution="CUDA Toolkit/Visual Studio Build Tools 설치는 시간이 오래 걸리고 관리자 승인 또는 터미널 재시작이 필요할 수 있습니다.",
        workflow="1",
    ),
    Tool(
        id="run_predict",
        title="inputs 폴더 이미지 -> PLY",
        bat="run_predict.bat",
        category="이미지 변환",
        input_mode="none",
        input_label="더블클릭형",
        summary="inputs 폴더 안의 이미지들을 Apple SHARP로 Gaussian Splatting PLY로 변환합니다.",
        result="outputs\\날짜시간 폴더에 .ply 결과가 저장됩니다.",
        caution="Apple SHARP 모델 checkpoint는 첫 실행 시 자동 다운로드됩니다.",
        workflow="2",
    ),
    Tool(
        id="run_predict_drag_image_here",
        title="지정 이미지/폴더 -> PLY",
        bat="run_predict_drag_image_here.bat",
        category="이미지 변환",
        input_mode="file_or_folder_required",
        input_label="파일/폴더 필요",
        summary="특정 이미지 파일이나 이미지 폴더만 골라서 PLY로 변환합니다.",
        result="선택한 대상 기준으로 outputs 폴더에 결과가 생성됩니다.",
        caution="브라우저 업로드가 아니라 Windows 파일/폴더 선택 경로를 BAT에 그대로 넘깁니다.",
        file_kind="both",
        extensions=(".jpg", ".jpeg", ".png", ".webp", ".bmp"),
        workflow="2",
    ),
    Tool(
        id="run_predict_render",
        title="이미지 -> PLY + SHARP MP4",
        bat="run_predict_render.bat",
        category="이미지 변환",
        input_mode="none",
        input_label="더블클릭형",
        summary="inputs 폴더 이미지를 PLY로 만든 뒤 SHARP 자체 MP4 렌더링까지 이어서 실행합니다.",
        result="outputs 폴더에 PLY와 MP4가 함께 생성됩니다.",
        caution="CUDA Toolkit, Visual Studio C++ Build Tools, gsplat CUDA 빌드가 필요할 수 있습니다.",
        workflow="2",
    ),
    Tool(
        id="run_predict_render_drag_image_here",
        title="지정 이미지/폴더 -> PLY + SHARP MP4",
        bat="run_predict_render_drag_image_here.bat",
        category="이미지 변환",
        input_mode="file_or_folder_required",
        input_label="파일/폴더 필요",
        summary="선택한 이미지 파일 또는 폴더만 PLY로 변환하고 SHARP 카메라 궤적 MP4까지 렌더링합니다.",
        result="outputs\\날짜시간 폴더에 선택한 대상의 PLY와 SHARP MP4가 저장됩니다.",
        caution="CUDA Toolkit, Visual Studio C++ Build Tools, gsplat CUDA 빌드가 필요할 수 있습니다.",
        file_kind="both",
        extensions=(".jpg", ".jpeg", ".png", ".webp", ".bmp"),
        workflow="2",
    ),
    Tool(
        id="run_predict_render_configured",
        title="지정 이미지/폴더 -> PLY + 경로 선택 MP4",
        bat="run_predict_render_drag_image_here.bat",
        category="이미지 변환",
        input_mode="predict_render_configurable",
        input_label="파일/폴더 + 경로 설정",
        summary="선택한 이미지 또는 폴더를 PLY로 만들고, 카메라 궤적과 이미지당 MP4 길이를 적용해 렌더링합니다.",
        result="outputs\\날짜시간 폴더에 PLY, 컬러 MP4, depth MP4가 저장됩니다.",
        caution="MP4 길이는 이미지 한 장당 길이입니다. 폴더 입력은 이미지마다 별도 MP4를 생성합니다.",
        file_kind="both",
        extensions=(".jpg", ".jpeg", ".png", ".webp", ".bmp"),
        workflow="2",
    ),
    Tool(
        id="merge_folder_videos",
        title="폴더 MP4 순서대로 하나로 합치기",
        bat="merge_folder_videos.bat",
        category="영상 도구",
        input_mode="folder_required",
        input_label="폴더 필요",
        summary="폴더 안의 SHARP 컬러 MP4를 파일명 번호 순서대로 연결해 하나의 MP4로 만듭니다.",
        result="선택 폴더에 SHARP_merged_날짜시간.mp4가 생성됩니다.",
        caution=".depth.mp4와 이전 SHARP_merged 결과는 자동 제외합니다. 모든 원본 MP4는 같은 해상도·코덱이어야 합니다.",
        file_kind="folder",
        extensions=(".mp4", ".mov", ".mkv", ".avi", ".webm"),
        workflow="3",
    ),
    Tool(
        id="render_ply_video",
        title="지정 PLY/폴더 -> 경로 선택 일반 MP4",
        bat="render_ply_video.bat",
        category="PLY 렌더링",
        input_mode="ply_render_configurable",
        input_label="자동/PLY 파일/폴더 + 경로 설정",
        summary="선택한 PLY 파일 또는 폴더를 카메라 경로와 PLY당 길이 설정으로 일반 MP4로 렌더링합니다.",
        result="outputs\\render_날짜시간 폴더에 MP4가 생성됩니다.",
        caution="PLY 폴더를 선택하면 각 PLY마다 MP4가 생성됩니다. 입력을 비우면 outputs 안의 최신 PLY를 자동 선택합니다.",
        file_kind="both",
        extensions=(".ply",),
        workflow="3",
    ),
    Tool(
        id="render_stereo_video",
        title="지정 PLY/폴더 -> 경로 선택 SBS MP4",
        bat="render_stereo_video.bat",
        category="PLY 렌더링",
        input_mode="ply_render_configurable",
        input_label="자동/PLY 파일/폴더 + 경로 설정",
        summary="선택한 PLY 파일 또는 폴더를 카메라 경로와 PLY당 길이 설정으로 좌우 SBS MP4로 렌더링합니다.",
        result="기본 IPD 0.064, 기본 길이 4초의 SBS MP4가 생성됩니다.",
        caution="PLY 폴더를 선택하면 각 PLY마다 SBS MP4가 생성됩니다. 입력을 비우면 outputs 안의 최신 PLY를 자동 선택합니다.",
        file_kind="both",
        extensions=(".ply",),
        workflow="3",
        default_duration=4.0,
    ),
    Tool(
        id="video_to_vr_pipeline",
        title="영상 -> VR SBS 전체 파이프라인",
        bat="video_to_vr_pipeline.bat",
        category="영상 파이프라인",
        input_mode="file_required",
        input_label="영상 필요",
        summary="영상 프레임 추출, 프레임별 PLY 생성, SBS 프레임 렌더링, VR MP4 조립까지 실행합니다.",
        result="outputs\\video_vr_날짜시간 폴더에 중간 산출물과 최종 VR SBS MP4가 저장됩니다.",
        caution="시간과 디스크를 매우 많이 사용합니다. 긴 영상은 먼저 테스트 5프레임으로 확인하세요.",
        extensions=(".mp4", ".mov", ".mkv", ".avi", ".webm"),
        workflow="4",
    ),
    Tool(
        id="video_to_vr_pipeline_60fps",
        title="60fps 영상 -> VR SBS",
        bat="video_to_vr_pipeline_60fps.bat",
        category="영상 파이프라인",
        input_mode="file_required",
        input_label="60fps 영상 필요",
        summary="60fps 원본 영상을 기준으로 전체 VR SBS 파이프라인을 실행합니다.",
        result="30fps 대비 더 부드러운 최종 MP4를 만들지만 처리량은 크게 늘어납니다.",
        caution="30fps 대비 처리 시간과 디스크 사용량이 대략 2배입니다.",
        extensions=(".mp4", ".mov", ".mkv", ".avi", ".webm"),
        workflow="4",
    ),
    Tool(
        id="resume_video_to_vr_pipeline_60fps",
        title="중단된 60fps VR SBS 작업 재개",
        bat="video_to_vr_pipeline_60fps.bat",
        category="영상 파이프라인",
        input_mode="video_resume_required",
        input_label="영상 + 결과 폴더 필요",
        summary="기존 PLY를 재추론하지 않고, 중단된 60fps VR SBS 파이프라인을 결과 폴더에서 이어서 처리합니다.",
        result="기존 02_ply를 SBS 프레임으로 변환하며, 성공한 PLY를 즉시 삭제해 디스크 공간을 확보합니다.",
        caution="입력 영상과 기존 결과 폴더가 같은 작업인지 확인하세요. 손상 또는 누락된 첫 프레임 번호부터 PNG를 다시 추출합니다.",
        extensions=(".mp4", ".mov", ".mkv", ".avi", ".webm"),
        workflow="4",
    ),
    Tool(
        id="resume_video_to_vr_pipeline",
        title="중단된 30fps VR SBS 작업 재개",
        bat="video_to_vr_pipeline.bat",
        category="영상 파이프라인",
        input_mode="video_resume_required",
        input_label="영상 + 결과 폴더 필요",
        summary="기존 PLY를 재추론하지 않고, 중단된 30fps VR SBS 파이프라인을 결과 폴더에서 이어서 처리합니다.",
        result="기존 02_ply를 SBS 프레임으로 변환하며, 성공한 PLY를 즉시 삭제해 디스크 공간을 확보합니다.",
        caution="입력 영상과 기존 결과 폴더가 같은 작업인지 확인하세요. 복구 시작 프레임을 비우면 첫 손상 프레임을 자동 감지합니다.",
        extensions=(".mp4", ".mov", ".mkv", ".avi", ".webm"),
        workflow="4",
    ),
    Tool(
        id="video_to_vr_pipeline_test_5frames",
        title="30초 지점 5프레임 테스트",
        bat="video_to_vr_pipeline_test_5frames.bat",
        category="영상 파이프라인",
        input_mode="file_optional",
        input_label="자동/영상 선택",
        summary="긴 파이프라인 전에 30초 지점부터 5프레임만 빠르게 처리해 상태를 확인합니다.",
        result="선택한 영상 또는 inputs\\clip_34_36.mp4 기준으로 작은 테스트 출력이 생성됩니다.",
        caution="전체 실행 전 CUDA, SHARP, ffmpeg, stereo 렌더링 연결을 점검하기 좋습니다.",
        extensions=(".mp4", ".mov", ".mkv", ".avi", ".webm"),
        workflow="4",
    ),
    Tool(
        id="make_youtube_3d_fpa",
        title="SBS MP4 -> YouTube 3D",
        bat="make_youtube_3d_fpa.bat",
        category="YouTube 변환",
        input_mode="file_required",
        input_label="SBS MP4 필요",
        summary="이미 만들어진 SBS 3D MP4에 YouTube/Quest에서 잘 인식된 3D 설정을 적용합니다.",
        result="원본 옆에 _youtube3d_fpa_dar16x9.mp4 파일을 생성합니다.",
        caution="frame-packing=3, SAR 1:2, DAR 16:9를 적용하는 현재 성공 조합입니다.",
        extensions=(".mp4", ".mov", ".mkv"),
        workflow="5",
    ),
    Tool(
        id="make_youtube_vr180_canvas",
        title="SBS MP4 -> VR180 테스트",
        bat="make_youtube_vr180_canvas.bat",
        category="YouTube 변환",
        input_mode="file_required",
        input_label="SBS MP4 필요",
        summary="SBS 영상을 7680x4320 VR180 스타일 캔버스로 포장하고 Spatial Media 메타데이터를 넣습니다.",
        result="원본 옆에 _youtube_vr180_8k_canvas_lr.mp4 파일을 생성합니다.",
        caution="진짜 180도 방향 정보가 생기는 것은 아니며 YouTube VR180 인식 테스트용입니다.",
        extensions=(".mp4", ".mov", ".mkv"),
        workflow="5",
    ),
    Tool(
        id="refresh_splat_list",
        title="WebXR PLY 목록 갱신",
        bat="refresh_splat_list.bat",
        category="Quest/WebXR",
        input_mode="none",
        input_label="더블클릭형",
        summary="outputs 폴더의 PLY를 WebXR 뷰어가 볼 수 있도록 목록 manifest를 갱신합니다.",
        result="webxr-spark-demo\\public\\splats와 manifest.json이 갱신됩니다.",
        caution="Quest에서 새 PLY가 안 보일 때 먼저 실행하세요.",
        workflow="6",
    ),
    Tool(
        id="run_webxr_demo",
        title="Quest/WebXR 뷰어 실행",
        bat="run_webxr_demo.bat",
        category="Quest/WebXR",
        input_mode="none",
        input_label="더블클릭형",
        summary="로컬 HTTPS WebXR/Spark 뷰어를 실행해 PC와 Quest 브라우저에서 PLY를 볼 수 있게 합니다.",
        result="https://192.168.50.149:5173/safe1 ~ /safe10 주소로 Quest에서 품질 단계별 확인이 가능합니다.",
        caution="Quest 브라우저에서 인증서 경고를 허용해야 할 수 있습니다.",
        workflow="6",
    ),
    Tool(
        id="run_webxr_demo_tunnel",
        title="WebXR 터널 실행",
        bat="run_webxr_demo_tunnel.bat",
        category="Quest/WebXR",
        input_mode="none",
        input_label="더블클릭형",
        summary="로컬 HTTPS 접속이 불편할 때 외부 HTTPS 터널 주소로 WebXR 뷰어를 열어봅니다.",
        result="콘솔에 출력되는 HTTPS 주소를 Quest 브라우저에서 사용합니다.",
        caution="터널 서비스 상태에 따라 접속이 느리거나 실패할 수 있습니다.",
        workflow="6",
    ),
]

TOOLS_BY_ID = {tool.id: tool for tool in TOOLS}


def tool_to_json(tool: Tool) -> dict[str, Any]:
    data = asdict(tool)
    data["batPath"] = str((PROJECT_ROOT / tool.bat).resolve())
    data["extensions"] = list(tool.extensions)
    return data


def build_launch_command(
    tool: Tool,
    selected_path: str | None,
    output_path: str | None = None,
    repair_frame: int | str | None = None,
    render_workers: int | str | None = None,
    ply_batch_size: int | str | None = None,
    trajectory: str | None = None,
    duration_seconds: float | str | None = None,
) -> list[str]:
    if tool.input_mode in ("file_required", "file_or_folder_required", "folder_required") and not selected_path:
        raise ValueError(f"{tool.title} needs a selected path.")

    command = ["cmd.exe", "/c", str((PROJECT_ROOT / tool.bat).resolve())]

    if tool.id == "batch_quest3_optimize":
        py_exe = str((PROJECT_ROOT / ".venv" / "Scripts" / "python.exe").resolve())
        py_pipe = str((PROJECT_ROOT / "scripts" / "sharp_pipeline.py").resolve())
        return ["cmd.exe", "/c", f'"{py_exe}" "{py_pipe}" -i "{selected_path}" --mode optimize_quest3 & pause']

    if tool.id == "batch_video_vr":
        py_exe = str((PROJECT_ROOT / ".venv" / "Scripts" / "python.exe").resolve())
        py_pipe = str((PROJECT_ROOT / "scripts" / "sharp_pipeline.py").resolve())
        return ["cmd.exe", "/c", f'"{py_exe}" "{py_pipe}" -i "{selected_path}" --mode batch_video_vr --resume & pause']
    if tool.input_mode in ("predict_render_configurable", "ply_render_configurable"):
        if tool.input_mode == "predict_render_configurable" and not selected_path:
            raise ValueError(f"{tool.title} needs a selected image or folder.")
        trajectory_name = trajectory or "rotate_forward"
        allowed_trajectories = {"rotate_forward", "rotate", "swipe", "shake"}
        if trajectory_name not in allowed_trajectories:
            raise ValueError(f"Unsupported trajectory: {trajectory_name}")
        try:
            duration_value = tool.default_duration if duration_seconds in (None, "") else duration_seconds
            duration = float(duration_value)
        except (TypeError, ValueError) as error:
            raise ValueError("Duration must be a positive number of seconds.") from error
        if duration <= 0:
            raise ValueError("Duration must be a positive number of seconds.")
        return command + [selected_path or "", trajectory_name, f"{duration:g}"]
    if tool.input_mode == "video_resume_required":
        if not selected_path:
            raise ValueError(f"{tool.title} needs a selected video.")
        if not output_path:
            raise ValueError(f"{tool.title} needs an existing output folder.")
        resume_arguments = [
            selected_path,
            "--output-dir",
            output_path,
            "--resume",
            "--delete-ply-after-render",
        ]
        if repair_frame not in (None, ""):
            try:
                repair_frame_number = int(repair_frame)
            except (TypeError, ValueError) as error:
                raise ValueError("Repair frame must be a positive whole number.") from error
            if repair_frame_number < 1:
                raise ValueError("Repair frame must be a positive whole number.")
            resume_arguments[4:4] = ["--repair-frames-from", str(repair_frame_number)]
        if render_workers not in (None, ""):
            try:
                render_worker_count = int(render_workers)
            except (TypeError, ValueError) as error:
                raise ValueError("Render workers must be a positive whole number.") from error
            if render_worker_count < 1:
                raise ValueError("Render workers must be a positive whole number.")
            resume_arguments += ["--render-workers", str(render_worker_count)]
        if ply_batch_size not in (None, ""):
            try:
                batch_size = int(ply_batch_size)
            except (TypeError, ValueError) as error:
                raise ValueError("PLY batch size must be a positive whole number.") from error
            if batch_size < 1:
                raise ValueError("PLY batch size must be a positive whole number.")
            resume_arguments += ["--ply-batch-size", str(batch_size)]
        return command + resume_arguments
    if selected_path and tool.input_mode != "none":
        command.append(selected_path)
    return command


def launch_tool(
    tool_id: str,
    selected_path: str | None,
    output_path: str | None = None,
    repair_frame: int | str | None = None,
    render_workers: int | str | None = None,
    ply_batch_size: int | str | None = None,
    trajectory: str | None = None,
    duration_seconds: float | str | None = None,
) -> dict[str, Any]:
    tool = TOOLS_BY_ID.get(tool_id)
    if tool is None:
        raise ValueError(f"Unknown tool: {tool_id}")

    if selected_path:
        selected = Path(selected_path)
        if not selected.exists():
            raise ValueError(f"Selected path does not exist: {selected_path}")
    if tool.input_mode == "video_resume_required":
        if not output_path:
            raise ValueError(f"{tool.title} needs an existing output folder.")
        output_dir = Path(output_path)
        if not output_dir.is_dir():
            raise ValueError(f"Output folder does not exist: {output_path}")

    command = build_launch_command(
        tool,
        selected_path,
        output_path,
        repair_frame,
        render_workers,
        ply_batch_size,
        trajectory,
        duration_seconds,
    )
    creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
    process = subprocess.Popen(command, cwd=PROJECT_ROOT, creationflags=creationflags)
    return {"pid": process.pid, "command": command}


def pick_path(kind: str, extensions: list[str]) -> str:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update()

    try:
        if kind == "folder":
            path = filedialog.askdirectory(parent=root, title="폴더를 선택하세요")
        else:
            patterns = " ".join(f"*{ext}" for ext in extensions) if extensions else "*.*"
            filetypes = [("지원 파일", patterns), ("모든 파일", "*.*")]
            path = filedialog.askopenfilename(parent=root, title="파일을 선택하세요", filetypes=filetypes)
    finally:
        root.destroy()

    return path or ""


def scan_folder(folder_str: str) -> dict[str, Any]:
    target = Path(folder_str)
    if not target.is_absolute():
        target = (PROJECT_ROOT / folder_str).resolve()
    else:
        target = target.resolve()

    if not target.exists() or not target.is_dir():
        raise ValueError(f"폴더가 존재하지 않거나 올바른 디렉토리가 아닙니다: {folder_str}")

    video_exts = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".m4v"}
    image_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
    ply_exts = {".ply"}

    videos = []
    images = []
    plys = []

    for item in target.iterdir():
        if not item.is_file():
            continue
        ext = item.suffix.lower()
        if ext in video_exts and not item.name.lower().endswith(".depth.mp4") and not item.name.lower().endswith(".alpha.mp4"):
            videos.append(item.name)
        elif ext in image_exts:
            images.append(item.name)
        elif ext in ply_exts:
            plys.append(item.name)

    import re
    def nkey(name: str):
        return [int(p) if p.isdigit() else p.casefold() for p in re.split(r"(\d+)", name)]

    videos.sort(key=nkey)
    images.sort(key=nkey)
    plys.sort(key=nkey)

    v_count = len(videos)
    i_count = len(images)
    p_count = len(plys)

    # Smart mode recommendation
    if v_count > 1:
        rec_mode = "batch_video_vr"
    elif v_count == 1:
        rec_mode = "video_vr"
    elif p_count > 0:
        rec_mode = "video_stereo"
    elif i_count > 0:
        rec_mode = "ply_only"
    else:
        rec_mode = "auto"

    return {
        "ok": True,
        "path": str(target),
        "folderName": target.name,
        "videoCount": v_count,
        "imageCount": i_count,
        "plyCount": p_count,
        "totalFiles": v_count + i_count + p_count,
        "videos": videos[:30],
        "images": images[:30],
        "plys": plys[:30],
        "recommendedMode": rec_mode,
    }


def launch_custom_pipeline(params: dict[str, Any]) -> dict[str, Any]:
    input_path = params.get("input")
    if not input_path:
        raise ValueError("입력 파일 또는 폴더를 선택해야 합니다.")
    
    target = Path(input_path)
    if not target.exists():
        raise ValueError(f"입력 경로가 존재하지 않습니다: {input_path}")

    python_exe = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
    pipeline_py = PROJECT_ROOT / "scripts" / "sharp_pipeline.py"
    with_cuda_bat = PROJECT_ROOT / "scripts" / "with_cuda_env.bat"

    py_args = [str(python_exe), str(pipeline_py), "-i", str(target)]

    if params.get("output") and str(params["output"]).strip():
        py_args += ["-o", str(params["output"]).strip()]

    if params.get("mode"):
        py_args += ["--mode", str(params["mode"])]
    if params.get("preset") and params["preset"] != "default":
        py_args += ["--preset", str(params["preset"])]
    if params.get("meuralOrientation") and params["meuralOrientation"] != "auto":
        py_args += ["--meural-orientation", str(params["meuralOrientation"])]
    if params.get("fps"):
        py_args += ["--fps", str(params["fps"])]
    if params.get("trajectory"):
        py_args += ["--trajectory", str(params["trajectory"])]
    if params.get("duration"):
        py_args += ["--duration", str(params["duration"])]
    if params.get("ipd"):
        py_args += ["--ipd", str(params["ipd"])]
    if params.get("renderWorkers"):
        py_args += ["--render-workers", str(params["renderWorkers"])]
    if params.get("plyBatchSize"):
        py_args += ["--ply-batch-size", str(params["plyBatchSize"])]
    if params.get("ytFormat") and params["ytFormat"] != "none":
        py_args += ["--yt-format", str(params["ytFormat"])]
    if params.get("resume"):
        py_args.append("--resume")
    if params.get("cleanPly"):
        py_args.append("--clean-ply")
    if params.get("renderDepth"):
        py_args.append("--render-depth")
    if params.get("startSeconds") and float(params["startSeconds"]) > 0:
        py_args += ["--start-seconds", str(params["startSeconds"])]
    if params.get("maxFrames") and int(params["maxFrames"]) > 0:
        py_args += ["--max-frames", str(params["maxFrames"])]

    args_str = " ".join(f'"{arg}"' if (" " in str(arg) or not str(arg)) else str(arg) for arg in py_args)
    full_cmd = f'cmd.exe /c "{args_str} & pause"'

    creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
    process = subprocess.Popen(full_cmd, cwd=PROJECT_ROOT, creationflags=creationflags)
    return {"pid": process.pid, "command": full_cmd}


def open_system_folder(folder_path: Path) -> None:
    if not folder_path.exists():
        folder_path.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(str(folder_path))
    else:
        subprocess.Popen(["xdg-open", str(folder_path)])


class DashboardHandler(SimpleHTTPRequestHandler):
    server_version = "SharpToolDashboard/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[dashboard] {self.address_string()} - {format % args}")

    def do_GET(self) -> None:
        if self.path in ("/", "/tool_dashboard.html"):
            self._send_file(DASHBOARD_HTML)
            return
        if self.path == "/api/tools":
            self._send_json({"tools": [tool_to_json(tool) for tool in TOOLS]})
            return
        if self.path == "/api/health":
            self._send_json({"ok": True, "projectRoot": str(PROJECT_ROOT)})
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        try:
            payload = self._read_json()
            if self.path == "/api/run_pipeline":
                result = launch_custom_pipeline(payload)
                self._send_json({"ok": True, **result})
                return
            if self.path == "/api/open_outputs":
                open_system_folder(PROJECT_ROOT / "outputs")
                self._send_json({"ok": True})
                return
            if self.path == "/api/run":
                result = launch_tool(
                    payload.get("id", ""),
                    payload.get("path") or None,
                    payload.get("outputPath") or None,
                    payload.get("repairFrame"),
                    payload.get("renderWorkers"),
                    payload.get("plyBatchSize"),
                    payload.get("trajectory") or None,
                    payload.get("durationSeconds"),
                )
                self._send_json({"ok": True, **result})
                return
            if self.path == "/api/pick":
                path = pick_path(payload.get("kind", "file"), payload.get("extensions", []))
                self._send_json({"ok": True, "path": path})
                return
            if self.path == "/api/scan_folder":
                folder_str = payload.get("folder") or ""
                result = scan_folder(folder_str)
                self._send_json(result)
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except Exception as error:
            self._send_json({"ok": False, "error": str(error)}, status=HTTPStatus.BAD_REQUEST)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path) -> None:
        if not path.exists():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def find_available_port(start_port: int) -> int:
    for port in range(start_port, start_port + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if probe.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No available dashboard port found.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the SHARP local tool dashboard.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=52345)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    port = find_available_port(args.port)
    server = ThreadingHTTPServer((args.host, port), DashboardHandler)
    url = f"http://{args.host}:{port}/"

    print("SHARP Tool Dashboard")
    print(f"Project: {PROJECT_ROOT}")
    print(f"URL: {url}")
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
