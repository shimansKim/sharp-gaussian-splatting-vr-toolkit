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


TOOLS = [
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
        id="render_ply_video",
        title="PLY -> 일반 MP4",
        bat="render_ply_video.bat",
        category="PLY 렌더링",
        input_mode="file_optional",
        input_label="자동/파일 선택",
        summary="이미 만들어진 PLY를 일반 카메라 궤적 MP4 영상으로 렌더링합니다.",
        result="outputs\\render_날짜시간 폴더에 MP4가 생성됩니다.",
        caution="파일을 지정하지 않으면 outputs 안의 최신 PLY를 자동 선택합니다.",
        extensions=(".ply",),
        workflow="3",
    ),
    Tool(
        id="render_stereo_video",
        title="PLY -> 좌우 SBS MP4",
        bat="render_stereo_video.bat",
        category="PLY 렌더링",
        input_mode="file_optional",
        input_label="자동/파일 선택",
        summary="PLY를 좌안/우안 side-by-side 양안 영상으로 렌더링합니다.",
        result="기본 IPD 0.064, 기본 길이 4초의 SBS MP4가 생성됩니다.",
        caution="파일을 지정하지 않으면 outputs 안의 최신 PLY를 자동 선택합니다.",
        extensions=(".ply",),
        workflow="3",
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


def build_launch_command(tool: Tool, selected_path: str | None) -> list[str]:
    if tool.input_mode in ("file_required", "file_or_folder_required") and not selected_path:
        raise ValueError(f"{tool.title} needs a selected path.")

    command = ["cmd.exe", "/c", str((PROJECT_ROOT / tool.bat).resolve())]
    if selected_path and tool.input_mode != "none":
        command.append(selected_path)
    return command


def launch_tool(tool_id: str, selected_path: str | None) -> dict[str, Any]:
    tool = TOOLS_BY_ID.get(tool_id)
    if tool is None:
        raise ValueError(f"Unknown tool: {tool_id}")

    if selected_path:
        selected = Path(selected_path)
        if not selected.exists():
            raise ValueError(f"Selected path does not exist: {selected_path}")

    command = build_launch_command(tool, selected_path)
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
            if self.path == "/api/run":
                result = launch_tool(payload.get("id", ""), payload.get("path") or None)
                self._send_json({"ok": True, **result})
                return
            if self.path == "/api/pick":
                path = pick_path(payload.get("kind", "file"), payload.get("extensions", []))
                self._send_json({"ok": True, "path": path})
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
