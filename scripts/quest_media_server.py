"""Quest 3 앱용 PC 미디어 서버.

PC 폴더(PLY·영상·사진)를 읽기 전용으로 LAN에 노출한다.
설계: notes/quest-app-design.md 4장.

- GET  /api/info            서버 정보 (앱이 연결 확인용으로 호출)
- POST /api/probe-result    실기기 프로브 결과 저장 (outputs/quest_probe_<시각>.json)
- GET  /api/list           폴더 한 단계. offset·limit(최대 5000)으로 나눠 받고 응답의 total·nextOffset으로 이어 받는다
- GET  /api/recent          최근 미디어. 종류 없이 부르면 PLY·영상·사진을 종류별 상한으로 고르게(프레임 시퀀스 폴더는 뺌),
                            kind=splat|video|image 로 한 종류만, include_sequences=1 로 프레임 포함. 응답 {items, counts, sequences}
- GET  /files/<root>/<rel>  파일 본문 (Range 지원)
- GET  /api/bindings        Quest 앱 컨트롤러 버튼 배정(바꾼 값만, quest_bindings.json). 없으면 {"bindings": {}, "updatedAt": 0}
- PUT  /api/bindings        배정 저장(앱 출처·같은 출처 설정 페이지만). 본문 {"bindings": {...}, "updatedAt": ms, "force": bool}. 저장된 것보다 옛 시각이면 409(force면 덮어씀)
- GET  /settings/bindings   PC 브라우저용 버튼 지정 페이지(같은 출처에서 /api/bindings를 쓴다)
- OPTIONS *                 CORS / Private Network Access 사전 요청

표준 라이브러리만으로 동작한다. zeroconf가 있으면 sharp-vr.local 이름을 광고한다.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
from collections import OrderedDict
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PORT = 8787
MDNS_HOST = "sharp-vr"
MDNS_SERVICE_TYPE = "_sharpvr._tcp.local."
APP_ID = "sharp-quest-server"
# 2: /api/info에 addresses, /api/list 쪽 나눔(total·nextOffset), /api/recent 종류별 버킷(counts·sequences).
# 3: 컨트롤러 버튼 배정(/api/bindings, PC 설정 페이지 /settings/bindings). 앱은 이보다 낮으면 '서버가 옛 버전'이라고 알린다.
API_VERSION = 3
PAGES_URL = "https://shimanskim.github.io/sharp-gaussian-splatting-vr-toolkit/"
FOLDERS_FILE = PROJECT_ROOT / "quest_server_folders.txt"
# 컨트롤러 버튼 배정(앱 2D 설정·PC 설정 페이지가 같이 쓴다). 동작 목록·기본값은 앱의 quest-app/src/core/bindings.js가 원본이다.
BINDINGS_FILE = PROJECT_ROOT / "quest_bindings.json"
BINDINGS_MODULE = PROJECT_ROOT / "quest-app" / "src" / "core" / "bindings.js"
BINDINGS_PAGE = Path(__file__).resolve().parent / "quest_bindings_page.html"
BINDINGS_PAGE_SCRIPT = Path(__file__).resolve().parent / "quest_bindings_page.js"
MAX_BINDINGS_BYTES = 64 * 1024
MAX_BINDINGS = 64
# 받는 updatedAt의 상한: 지금 + 이만큼(ms). 시계가 앞선 기기가 먼 미래 시각으로 저장해 다른 쪽 변경을 오래(409) 막지 못하게 짧게 둔다.
MAX_BINDINGS_CLOCK_SKEW_MS = 5 * 60 * 1000
BINDING_ID_RE = re.compile(r"^(common|media|splat)\.[A-Za-z]{1,32}$")
BINDING_HANDS = {"left", "right", "either"}
BINDING_BUTTONS = {"trigger", "grip", "primary", "secondary", "stick"}
BINDING_MODES = {"press", "hold"}
CHUNK = 1024 * 1024
MAX_POST_BYTES = 1024 * 1024
MAX_LIST = 5000     # /api/list 한 번에 돌려주는 최대 항목 수(페이지 크기 상한). 더 많으면 offset으로 이어 받는다
MAX_LIST_SCAN = 100000  # /api/list가 한 폴더에서 읽는 항목 수의 안전 상한
LIST_CACHE_TTL = 30.0   # 초. 같은 폴더를 쪽마다(offset) 다시 읽지 않게 목록을 잠깐 기억한다
LIST_CACHE_FOLDERS = 8  # 기억하는 폴더 수(가장 오래 안 쓴 것부터 버린다)
MAX_RECENT = 1000   # /api/recent limit 상한
MAX_WALK = 20000    # 재귀 탐색에서 모으는 파일 수 상한
MAX_DEPTH = 8
RECENT_TTL = 5.0    # 초
SEQUENCE_MIN = 30   # 같은 폴더에서 이름 모양이 같은 이미지가 이만큼 되면 영상에서 뽑은 프레임 시퀀스 후보로 본다
SEQUENCE_STEP_SHARE = 0.9  # 후보의 프레임 번호 간격이 한 값(보통 1)으로 이만큼 이상 같아야 시퀀스로 확정한다
# 카메라·휴대폰 사진 이름(IMG_0001.jpg, DSC01234.JPG, PXL_20260101_….jpg 등). 손실 압축 확장자면 시퀀스로 보지 않는다.
CAMERA_NAME_RE = re.compile(r"^(img|dsc[nf]?|pxl|dji|mvimg|gopr|gp|dcim|pict|wa|signal|screenshot)[_\-. ]*\d", re.IGNORECASE)
LOSSY_PHOTO_EXT = {".jpg", ".jpeg", ".webp", ".avif"}
MAX_SEQUENCES = 200 # 응답에 담는 시퀀스 폴더 수 상한
MAX_SEQUENCE_FILES = 20000  # include_sequences=1 용으로 따로 모아 두는 프레임 수 상한
# 종류를 지정하지 않은 /api/recent 의 종류별 상한. 프레임·사진이 영상·PLY를 밀어내지 않게 한다.
RECENT_PER_KIND = {"splat": 300, "video": 500, "image": 100}

# 앱이 호스팅되는 출처. 요청 Origin이 여기 있거나 LAN 개발 서버(https://<사설 IP>:5173)일 때만 반사한다.
ALLOWED_ORIGINS = {
    "https://shimanskim.github.io",
    "https://localhost:5173",
    "https://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}
LAN_ORIGIN_RE = re.compile(
    r"^https?://(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):5173$"
)

KIND_BY_EXT = {
    ".ply": "splat", ".splat": "splat", ".spz": "splat",
    ".mp4": "video", ".m4v": "video", ".webm": "video", ".mov": "video", ".mkv": "video",
    ".jpg": "image", ".jpeg": "image", ".png": "image", ".webp": "image", ".avif": "image",
}
MIME_BY_EXT = {
    ".ply": "application/octet-stream",
    ".splat": "application/octet-stream",
    ".spz": "application/octet-stream",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
}


# ---------------------------------------------------------------- 네트워크 유틸

def is_private_ipv4(ip: str) -> bool:
    try:
        a, b, *_ = (int(x) for x in ip.split("."))
    except ValueError:
        return False
    return a == 10 or (a == 192 and b == 168) or (a == 172 and 16 <= b <= 31)


def primary_ipv4() -> str | None:
    """기본 경로로 나가는 인터페이스의 IPv4 (패킷은 보내지 않는다)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        return ip if not ip.startswith("127.") else None
    except OSError:
        return None
    finally:
        s.close()


def lan_ipv4_candidates() -> list[str]:
    """사설 IPv4 후보. 기본 경로 주소를 맨 앞에 둔다."""
    found: list[str] = []
    primary = primary_ipv4()
    if primary:
        found.append(primary)
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if is_private_ipv4(ip) and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return found


# ---------------------------------------------------------------- 공개 폴더

def sanitize_id(name: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z_-]+", "-", name).strip("-").lower()
    return cleaned or "folder"


def read_folders_file() -> list[Path]:
    if not FOLDERS_FILE.is_file():
        return []
    paths: list[Path] = []
    for line in FOLDERS_FILE.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            paths.append(Path(line))
    return paths


def build_roots(extra: list[Path], remember: bool) -> dict[str, Path]:
    """{root id: 절대 경로}. 첫 항목은 항상 outputs(없으면 만든다)."""
    outputs = PROJECT_ROOT / "outputs"
    outputs.mkdir(exist_ok=True)
    candidates = [outputs, *read_folders_file(), *extra]
    roots: dict[str, Path] = {}
    seen: set[Path] = set()
    for path in candidates:
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if not resolved.is_dir() or resolved in seen:
            print(f"[경고] 폴더를 건너뜁니다(없거나 중복): {path}")
            continue
        seen.add(resolved)
        base = sanitize_id(resolved.name)
        rid, n = base, 2
        while rid in roots:
            rid, n = f"{base}-{n}", n + 1
        roots[rid] = resolved
    if remember and extra:
        remembered = {p.resolve() for p in read_folders_file() if p.is_dir()}
        new = [p.resolve() for p in extra if p.is_dir() and p.resolve() not in remembered]
        if new:
            with FOLDERS_FILE.open("a", encoding="utf-8", newline="") as fh:
                for p in new:
                    fh.write(f"{p}\r\n")
            print(f"[기억] quest_server_folders.txt에 {len(new)}개 폴더를 추가했습니다.")
    return roots


def resolve_in_root(root: Path, rel: str) -> Path | None:
    """root 안의 실제 경로. 루트 밖(.., 심볼릭 링크, NTFS 대체 스트림)이면 None."""
    if "\x00" in rel or "\\" in rel:
        return None
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if any(p == ".." or ":" in p for p in parts):
        return None
    try:
        target = root.joinpath(*parts).resolve()
        target.relative_to(root)
    except (OSError, ValueError):
        return None
    return target


# ---------------------------------------------------------------- HTTP 핸들러

class QuestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "SharpQuestServer/1"

    # 서버 설정은 server 객체에 둔다 (QuestServer 참조)
    @property
    def cfg(self) -> "QuestServer":
        return self.server  # type: ignore[return-value]

    # -- 공통
    def log_message(self, fmt: str, *args: Any) -> None:
        if self.cfg.verbose:
            sys.stdout.write(
                "%s - %s\n" % (self.address_string(), fmt % args)
            )

    def origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        if origin is None:
            return True  # 같은 출처 요청·curl·주소창 접속
        return origin in ALLOWED_ORIGINS or bool(LAN_ORIGIN_RE.match(origin)) or origin in self.cfg.extra_origins or self.same_origin(origin)

    def same_origin(self, origin: str) -> bool:
        """이 서버가 내보낸 페이지(/settings/bindings)에서 온 요청: Origin이 http://<Host 헤더>와 같고 Host가 허용된 이름이다."""
        host = self.headers.get("Host")
        return bool(host) and host_allowed(host, self.cfg.extra_hosts) and origin.lower() == f"http://{host}".lower()

    def cors_headers(self) -> list[tuple[str, str]]:
        headers: list[tuple[str, str]] = [
            ("Vary", "Origin"),
            ("Access-Control-Allow-Private-Network", "true"),
            ("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges"),
        ]
        origin = self.headers.get("Origin")
        if origin and self.origin_allowed():
            headers.append(("Access-Control-Allow-Origin", origin))
        return headers

    def send_bytes(self, status: int, body: bytes, content_type: str, extra: list[tuple[str, str]] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in self.cors_headers() + (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8")

    def send_error_json(self, status: int, message: str) -> None:
        self.send_json(status, {"error": message})

    # -- 메서드
    def host_ok(self) -> bool:
        if host_allowed(self.headers.get("Host"), self.cfg.extra_hosts):
            return True
        self.send_error_json(HTTPStatus.FORBIDDEN, "host not allowed")
        return False

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self.host_ok():
            return
        if not self.origin_allowed():
            self.send_error_json(HTTPStatus.FORBIDDEN, "origin not allowed")
            return
        req_headers = self.headers.get("Access-Control-Request-Headers", "Range, Content-Type")
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", req_headers)
        self.send_header("Access-Control-Max-Age", "600")
        for k, v in self.cors_headers():
            self.send_header(k, v)
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_GET(self) -> None:  # noqa: N802
        try:
            if not self.host_ok():
                return
            path = urlsplit(self.path).path
            if path == "/api/info":
                self.handle_info()
            elif path == "/api/list":
                self.handle_list(parse_qs(urlsplit(self.path).query))
            elif path == "/api/recent":
                self.handle_recent(parse_qs(urlsplit(self.path).query))
            elif path.startswith("/files/"):
                self.handle_file(path[len("/files/"):])
            elif path == "/api/bindings":
                self.handle_bindings_get()
            elif path in ("/settings/bindings", "/settings/bindings/"):
                self.handle_static(BINDINGS_PAGE, "text/html; charset=utf-8")
            elif path == "/settings/bindings.js":
                self.handle_static(BINDINGS_MODULE, "text/javascript; charset=utf-8")
            elif path == "/settings/bindings-page.js":
                self.handle_static(BINDINGS_PAGE_SCRIPT, "text/javascript; charset=utf-8")
            else:
                self.send_error_json(HTTPStatus.NOT_FOUND, "not found")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def do_PUT(self) -> None:  # noqa: N802
        try:
            if not self.host_ok():
                return
            path = urlsplit(self.path).path
            if path == "/api/bindings":
                self.handle_bindings_put()
            else:
                self.send_error_json(HTTPStatus.NOT_FOUND, "not found")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def do_POST(self) -> None:  # noqa: N802
        try:
            if not self.host_ok():
                return
            path = urlsplit(self.path).path
            if path == "/api/probe-result":
                self.handle_probe_result()
            else:
                self.send_error_json(HTTPStatus.NOT_FOUND, "not found")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    # -- /api/info
    def handle_info(self) -> None:
        self.send_json(HTTPStatus.OK, {
            "app": APP_ID,
            "version": API_VERSION,
            "host": socket.gethostname(),
            "mdns": f"{MDNS_HOST}.local" if self.cfg.mdns_active else None,
            "addresses": self.cfg.lan_addresses(),  # 앱이 이 PC의 공유기 대역을 기억해 다음 탐색에서 먼저 보게 한다
            "probe": self.cfg.probe,
            "roots": [{"id": rid, "label": path.name or rid} for rid, path in self.cfg.roots.items()],
        })

    # -- /api/list?root=<id>&path=<rel>
    def handle_list(self, query: dict[str, list[str]]) -> None:
        root_id = (query.get("root") or [""])[0]
        rel = (query.get("path") or [""])[0]
        root = self.cfg.roots.get(root_id)
        if root is None:
            self.send_error_json(HTTPStatus.NOT_FOUND, "unknown root")
            return
        target = resolve_in_root(root, rel)
        if target is None:
            self.send_error_json(HTTPStatus.FORBIDDEN, "path outside root")
            return
        if not target.is_dir():
            self.send_error_json(HTTPStatus.NOT_FOUND, "not a directory")
            return
        rel_norm = "/".join(p for p in rel.split("/") if p not in ("", "."))
        everything = self.cfg.folder_entries(root_id, root, target, rel_norm)
        try:
            offset = max(0, int((query.get("offset") or ["0"])[0]))
            limit = int((query.get("limit") or [str(MAX_LIST)])[0])
        except ValueError:
            offset, limit = 0, MAX_LIST
        limit = max(1, min(limit, MAX_LIST))
        items = everything[offset:offset + limit]
        next_offset = offset + len(items)
        self.send_json(HTTPStatus.OK, {
            "root": root_id,
            "path": rel_norm,
            "items": items,
            "total": len(everything),
            "offset": offset,
            "nextOffset": next_offset if next_offset < len(everything) else None,
        })

    # -- /api/recent?kind=splat&limit=200
    def handle_recent(self, query: dict[str, list[str]]) -> None:
        kind = (query.get("kind") or [""])[0] or None
        if kind is not None and kind not in ("splat", "video", "image"):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "kind must be splat, video or image")
            return
        try:
            limit = int((query.get("limit") or ["200"])[0])
        except ValueError:
            limit = 200
        limit = max(1, min(limit, MAX_RECENT))
        include_sequences = (query.get("include_sequences") or [""])[0].lower() in ("1", "true", "yes")
        self.send_json(HTTPStatus.OK, self.cfg.recent_files(kind, limit, include_sequences))

    # -- /api/probe-result
    def handle_probe_result(self) -> None:
        if not self.origin_allowed():
            self.send_error_json(HTTPStatus.FORBIDDEN, "origin not allowed")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_POST_BYTES:
            self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "body must be 1..1048576 bytes")
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "invalid json")
            return
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_dir = PROJECT_ROOT / "outputs"
        out_dir.mkdir(exist_ok=True)
        out = out_dir / f"quest_probe_{stamp}.json"
        record = {
            "receivedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "clientAddress": self.client_address[0],
            "origin": self.headers.get("Origin"),
            "userAgent": self.headers.get("User-Agent"),
            "result": data,
        }
        out.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[프로브] 결과를 저장했습니다: {out}")
        self.send_json(HTTPStatus.OK, {"saved": out.name})

    # -- /api/bindings (GET)
    def handle_bindings_get(self) -> None:
        self.send_json(HTTPStatus.OK, self.cfg.read_bindings())

    # -- /api/bindings (PUT)
    def put_origin_allowed(self) -> bool:
        """배정 저장(PUT)은 읽기보다 좁게: 앱이 호스팅되는 출처(ALLOWED_ORIGINS)·--allow-origin으로 더한 출처·이 서버의 설정 페이지(같은 출처)만.
        Origin이 없는 요청(curl 등)과 LAN 개발 서버 출처(https://<사설 IP>:5173)는 받지 않는다(같은 공유기의 다른 기기 페이지가 바꾸지 못하게)."""
        origin = self.headers.get("Origin")
        if not origin:
            return False
        return origin in ALLOWED_ORIGINS or origin in self.cfg.extra_origins or self.same_origin(origin)

    def handle_bindings_put(self) -> None:
        if not self.put_origin_allowed():
            self.send_error_json(HTTPStatus.FORBIDDEN, "origin not allowed")
            return
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != "application/json":
            # 폼·text/plain 같은 '단순 요청'으로는 바꿀 수 없게 한다(CSRF 대비).
            self.send_error_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "content-type must be application/json")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BINDINGS_BYTES:
            self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, f"body must be 1..{MAX_BINDINGS_BYTES} bytes")
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "invalid json")
            return
        try:
            record = validate_bindings_payload(data)
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        force = isinstance(data, dict) and data.get("force") is True
        saved, current = self.cfg.write_bindings(record, force)
        if not saved:
            # 저장된 것이 더 최근이다: "나중에 바꾼 쪽이 이긴다". 앱은 받은 current를 적용하면 된다.
            self.send_json(HTTPStatus.CONFLICT, {"error": "stored bindings are newer", "current": current})
            return
        self.send_json(HTTPStatus.OK, current)

    # -- /settings/bindings(.js): PC 브라우저용 설정 페이지와 그 페이지가 쓰는 앱의 배정 모듈
    def handle_static(self, path: Path, content_type: str) -> None:
        try:
            body = path.read_bytes()
        except OSError:
            self.send_error_json(HTTPStatus.NOT_FOUND, f"{path.name} not found (quest-app 폴더가 서버와 같은 저장소에 있어야 합니다)")
            return
        self.send_bytes(HTTPStatus.OK, body, content_type, [("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'")])

    # -- /files/<root>/<rel>
    def handle_file(self, tail: str) -> None:
        root_id, _, rel = unquote(tail).partition("/")
        root = self.cfg.roots.get(root_id)
        if root is None:
            self.send_error_json(HTTPStatus.NOT_FOUND, "unknown root")
            return
        target = resolve_in_root(root, rel)
        if target is None:
            self.send_error_json(HTTPStatus.FORBIDDEN, "path outside root")
            return
        # 목록에 나오는 것(숨김이 아닌 PLY·영상·사진)만 내보낸다. .env·메모·숨김 폴더 안 파일은 404.
        if any(part.startswith(".") and part not in ("", ".") for part in rel.replace("\\", "/").split("/")) or file_kind(rel) is None:
            self.send_error_json(HTTPStatus.NOT_FOUND, "not a media file")
            return
        if not target.is_file():
            self.send_error_json(HTTPStatus.NOT_FOUND, "not a file")
            return
        size = target.stat().st_size
        ext = target.suffix.lower()
        ctype = MIME_BY_EXT.get(ext) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"

        start, end, status = 0, size - 1, HTTPStatus.OK
        extra: list[tuple[str, str]] = [("Accept-Ranges", "bytes")]
        range_header = self.headers.get("Range")
        if range_header:
            parsed = parse_range(range_header, size)
            if parsed is None:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                for k, v in self.cors_headers():
                    self.send_header(k, v)
                self.end_headers()
                return
            start, end = parsed
            status = HTTPStatus.PARTIAL_CONTENT
            extra.append(("Content-Range", f"bytes {start}-{end}/{size}"))

        length = end - start + 1 if size else 0
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in self.cors_headers() + extra:
            self.send_header(k, v)
        self.end_headers()
        if self.command == "HEAD" or length == 0:
            return
        with target.open("rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining > 0:
                chunk = fh.read(min(CHUNK, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


def inside_root(root: Path, path: str | os.PathLike[str]) -> bool:
    """실제 경로(심볼릭 링크·정션을 따라간 결과)가 root 안인가. 정션은 is_symlink()가 False라 이렇게 확인한다."""
    try:
        Path(os.path.realpath(path)).relative_to(root)
    except (OSError, ValueError):
        return False
    return True


def host_allowed(host_header: str | None, extra_hosts: frozenset[str] | set[str] = frozenset()) -> bool:
    """Host 헤더 검사(DNS 리바인딩 대비). IP 주소, localhost, sharp-vr.local, 이 PC의 호스트 이름(.local 포함)과
    --allow-host로 더한 이름만 받는다. 헤더가 없는 HTTP/1.0 요청은 받는다."""
    if not host_header:
        return True
    host = host_header.strip().lower()
    port_text = ""
    if host.startswith("["):  # [::1]:8787
        host, _, rest = host[1:].partition("]")
        port_text = rest[1:] if rest.startswith(":") else rest
    elif host.count(":") == 1:
        host, _, port_text = host.partition(":")
    if port_text and not (port_text.isascii() and port_text.isdigit()):
        return False  # 포트 자리에 숫자가 아닌 것이 있다(예: "127.0.0.1:8787@evil.com")
    host = host.rstrip(".")
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return True  # IP 주소를 직접 쓰면 이름 해석을 속일 수 없다
    except ValueError:
        pass
    pc = socket.gethostname().lower()
    return host in ({"localhost", "sharp-vr.local", pc, f"{pc}.local"} | {h.lower() for h in extra_hosts})


def validate_binding_value(value: Any) -> dict[str, str] | None:
    """배정 값 하나. None(지정 안 함)·버튼 {hand, button, mode}·축 {hand, axis}·스틱 {hand}만 받는다."""
    if value is None:
        return None
    if not isinstance(value, dict) or not value or len(value) > 3:
        raise ValueError("binding value must be null or an object")
    keys = set(value)
    hand = value.get("hand")
    if keys <= {"hand", "button", "mode"} and "button" in keys:
        mode = value.get("mode", "press")
        if hand not in BINDING_HANDS or value["button"] not in BINDING_BUTTONS or mode not in BINDING_MODES:
            raise ValueError("bad button binding")
        return {"hand": hand, "button": value["button"], "mode": mode}
    if keys == {"hand", "axis"}:
        if hand not in ("left", "right") or value["axis"] not in ("x", "y"):
            raise ValueError("bad axis binding")
        return {"hand": hand, "axis": value["axis"]}
    if keys == {"hand"}:
        if hand not in ("left", "right"):
            raise ValueError("bad stick binding")
        return {"hand": hand}
    raise ValueError("unknown binding shape")


def validate_bindings_payload(data: Any) -> dict[str, Any]:
    """PUT /api/bindings 본문 → 저장할 레코드 {version, updatedAt, bindings}. 잘못되면 ValueError."""
    if not isinstance(data, dict) or not isinstance(data.get("bindings"), dict):
        raise ValueError("body must be {\"bindings\": {...}}")
    raw = data["bindings"]
    if len(raw) > MAX_BINDINGS:
        raise ValueError("too many bindings")
    bindings: dict[str, Any] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not BINDING_ID_RE.match(key):
            raise ValueError(f"bad action id: {str(key)[:40]}")
        bindings[key] = validate_binding_value(value)
    updated = data.get("updatedAt")
    now_ms = int(time.time() * 1000)
    if updated is None:
        updated = now_ms
    if isinstance(updated, bool) or not isinstance(updated, (int, float)) or updated < 0:
        raise ValueError("updatedAt must be a number (ms)")
    # 시계가 앞선 기기가 먼 미래 시각으로 다른 쪽 변경을 오래 막지 못하게 몇 분 뒤까지만 받는다.
    updated = int(min(updated, now_ms + MAX_BINDINGS_CLOCK_SKEW_MS))
    return {"version": 1, "updatedAt": updated, "bindings": bindings}


def file_kind(name: str) -> str | None:
    return KIND_BY_EXT.get(os.path.splitext(name)[1].lower())


def file_entry(root_id: str, rel: str, name: str, st: os.stat_result) -> dict[str, Any]:
    return {
        "root": root_id,
        "name": name,
        "path": rel,
        "type": "file",
        "kind": file_kind(name),
        "size": st.st_size,
        "mtime": int(st.st_mtime * 1000),  # epoch ms
    }


def list_directory(root_id: str, root: Path, directory: Path, rel: str) -> list[dict[str, Any]]:
    """폴더 한 단계. 하위 폴더 먼저(이름순), 그다음 파일(이름순). 숨김 항목은 뺀다."""
    dirs: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    try:
        entries = sorted(os.scandir(directory), key=lambda e: e.name.lower())
    except OSError:
        return []
    for entry in entries[:MAX_LIST_SCAN]:
        if entry.name.startswith("."):
            continue
        child_rel = f"{rel}/{entry.name}" if rel else entry.name
        try:
            if (entry.is_dir() or entry.is_symlink()) and not inside_root(root, entry.path):
                continue  # 루트 밖을 가리키는 링크·정션은 이름도 보이지 않게 한다
            st = entry.stat()
            if entry.is_dir():
                dirs.append({
                    "root": root_id, "name": entry.name, "path": child_rel, "type": "dir",
                    "kind": None, "size": None, "mtime": int(st.st_mtime * 1000),
                })
            elif entry.is_file():
                files.append(file_entry(root_id, child_rel, entry.name, st))
        except OSError:
            continue
    return dirs + files


def sequence_key(name: str) -> str:
    """숫자 덩어리를 #으로 바꾼 이름. frame_000983.sbs.png 와 frame_000984.sbs.png 는 같은 키가 된다."""
    return re.sub(r"\d+", "#", name.lower())


def is_frame_sequence(names: list[str]) -> bool:
    """이름 모양이 같은 이미지(sequence_key가 같은 한 묶음)가 영상에서 뽑은 프레임 시퀀스인가.

    - SEQUENCE_MIN장 이상이어야 한다.
    - 카메라·휴대폰 사진 이름(IMG_·DSC·PXL_ 등)의 JPEG·WebP·AVIF는 사진 모음이므로 시퀀스가 아니다.
    - 프레임 번호(이름에서 가장 다양하게 바뀌는 숫자 자리)를 정렬했을 때 이웃과의 간격이 한 값으로
      SEQUENCE_STEP_SHARE 이상 같아야 한다. 휴대폰 사진처럼 번호가 듬성듬성 빠진 모음은 걸러진다.
    """
    if len(names) < SEQUENCE_MIN:
        return False
    if os.path.splitext(names[0])[1].lower() in LOSSY_PHOTO_EXT and CAMERA_NAME_RE.match(names[0]):
        return False
    groups = [[int(n) for n in re.findall(r"\d+", name)] for name in names]
    width = len(groups[0])
    if width == 0 or any(len(g) != width for g in groups):
        return False
    column = max(range(width), key=lambda i: len({g[i] for g in groups}))
    numbers = sorted({g[column] for g in groups})
    if len(numbers) < SEQUENCE_MIN:
        return False
    steps: dict[int, int] = {}
    for a, b in zip(numbers, numbers[1:]):
        steps[b - a] = steps.get(b - a, 0) + 1
    return max(steps.values()) / (len(numbers) - 1) >= SEQUENCE_STEP_SHARE


def walk_media(root_id: str, root: Path, kind: str | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """루트 아래 미디어 파일을 재귀로 모은다. 심볼릭 링크와 숨김 폴더는 따라가지 않는다.

    폴더 안에서 이름 모양(sequence_key)이 같고 번호가 규칙적으로 이어지는 이미지 SEQUENCE_MIN장 이상(is_frame_sequence)을
    프레임 시퀀스로 보고 파일 목록(found)에서 빼 별도로 돌려준다. 시퀀스 프레임은 MAX_WALK 집계에도 넣지 않으므로
    수천 장의 프레임이 다른 폴더의 영상·PLY를 밀어내지 못한다.

    반환: (found, sequences, sequence_files)
      sequences       시퀀스 폴더 요약 [{root, path, name, count, mtime}]
      sequence_files  시퀀스에 속한 프레임 파일 항목(include_sequences 용, MAX_SEQUENCE_FILES까지)
    """
    found: list[dict[str, Any]] = []
    sequences: list[dict[str, Any]] = []
    sequence_files: list[dict[str, Any]] = []
    stack: list[tuple[Path, str, int]] = [(root, "", 0)]
    while stack and len(found) < MAX_WALK:
        directory, rel, depth = stack.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        images: list[dict[str, Any]] = []
        for entry in entries:
            if entry.name.startswith(".") or entry.is_symlink():
                continue
            child_rel = f"{rel}/{entry.name}" if rel else entry.name
            try:
                if entry.is_dir():
                    if not inside_root(root, entry.path):
                        continue  # 정션 등으로 루트 밖을 가리키는 폴더는 따라가지 않는다
                    if depth < MAX_DEPTH:
                        stack.append((Path(entry.path), child_rel, depth + 1))
                elif entry.is_file():
                    entry_kind = file_kind(entry.name)
                    if entry_kind and (kind is None or entry_kind == kind):
                        item = file_entry(root_id, child_rel, entry.name, entry.stat())
                        (images if entry_kind == "image" else found).append(item)
            except OSError:
                continue
        if images:
            by_key: dict[str, list[dict[str, Any]]] = {}
            for item in images:
                by_key.setdefault(sequence_key(item["name"]), []).append(item)
            sequence_keys = {key for key, group in by_key.items() if is_frame_sequence([g["name"] for g in group])}
            frames = [item for item in images if sequence_key(item["name"]) in sequence_keys]
            found.extend(item for item in images if sequence_key(item["name"]) not in sequence_keys)
            if frames and len(sequences) < MAX_SEQUENCES:
                sequences.append({
                    "root": root_id,
                    "path": rel,
                    "name": directory.name if rel else root_id,
                    "count": len(frames),
                    "mtime": max(item["mtime"] for item in frames),
                })
            room = MAX_SEQUENCE_FILES - len(sequence_files)
            if room > 0:
                sequence_files.extend(frames[:room])
    return found, sequences, sequence_files


def parse_range(header: str, size: int) -> tuple[int, int] | None:
    """`bytes=a-b` 한 구간만 지원. 해석 불가·범위 밖이면 None(416)."""
    m = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
    if not m or size <= 0:
        return None
    first, last = m.groups()
    if first == "" and last == "":
        return None
    if first == "":  # 마지막 n바이트
        n = int(last)
        if n == 0:
            return None
        return max(0, size - n), size - 1
    start = int(first)
    end = int(last) if last else size - 1
    if start >= size or end < start:
        return None
    return start, min(end, size - 1)


class QuestServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows의 SO_REUSEADDR는 같은 포트에 서버가 둘 뜨는 것을 허용하므로 쓰지 않는다.
    allow_reuse_address = os.name != "nt"
    request_queue_size = 64

    def __init__(self, addr: tuple[str, int], roots: dict[str, Path], probe: bool, verbose: bool, extra_origins: set[str], extra_hosts: set[str] | None = None, bindings_path: Path | None = None):
        super().__init__(addr, QuestHandler)
        self.bindings_path = bindings_path or BINDINGS_FILE
        self._bindings_lock = threading.Lock()
        self.roots = roots
        self.probe = probe
        self.verbose = verbose
        self.extra_origins = extra_origins
        self.extra_hosts = frozenset(extra_hosts or ())
        self.mdns_active = False
        self._addresses: list[str] | None = None
        self._recent_lock = threading.Lock()
        self._recent_cache: tuple[float, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]] | None = None
        self._list_lock = threading.Lock()
        self._list_cache: "OrderedDict[tuple[str, str], tuple[float, int, list[dict[str, Any]]]]" = OrderedDict()

    def read_bindings(self) -> dict[str, Any]:
        """저장된 배정. 파일이 없거나 깨졌으면 빈 배정(앱 기본값을 쓰라는 뜻)."""
        with self._bindings_lock:
            return self._read_bindings_unlocked()

    def _read_bindings_unlocked(self) -> dict[str, Any]:
        try:
            data = json.loads(self.bindings_path.read_text(encoding="utf-8"))
            return validate_bindings_payload(data)
        except (OSError, ValueError):
            return {"version": 1, "updatedAt": 0, "bindings": {}}

    def write_bindings(self, record: dict[str, Any], force: bool) -> tuple[bool, dict[str, Any]]:
        """저장. 저장된 것이 더 최근이면(force가 아니면) 저장하지 않고 (False, 저장된 것)을 돌려준다."""
        with self._bindings_lock:
            current = self._read_bindings_unlocked()
            if not force and current["updatedAt"] > record["updatedAt"]:
                return False, current
            tmp = self.bindings_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, self.bindings_path)
            return True, record

    def folder_entries(self, root_id: str, root: Path, target: Path, rel: str) -> list[dict[str, Any]]:
        """/api/list용 폴더 항목 전체. 폴더 수정 시각(mtime)이 그대로이고 LIST_CACHE_TTL 안이면 다시 읽지 않는다.

        수천 장 폴더를 5000개씩 나눠 받을 때 쪽마다 폴더 전체를 읽고 정렬하는 일을 피한다.
        폴더에 파일이 생기거나 사라지면 폴더 mtime이 바뀌어 바로 무효가 된다. 이미 있는 파일의 내용·크기가
        바뀐 경우는 최대 TTL만큼 늦게 반영된다.
        """
        key = (root_id, rel)
        try:
            stamp = target.stat().st_mtime_ns
        except OSError:
            stamp = -1
        now = time.monotonic()
        with self._list_lock:
            hit = self._list_cache.get(key)
            if hit and hit[1] == stamp and now - hit[0] < LIST_CACHE_TTL:
                self._list_cache.move_to_end(key)
                return hit[2]
        entries = list_directory(root_id, root, target, rel)
        with self._list_lock:
            self._list_cache[key] = (now, stamp, entries)
            self._list_cache.move_to_end(key)
            while len(self._list_cache) > LIST_CACHE_FOLDERS:
                self._list_cache.popitem(last=False)
        return entries

    def lan_addresses(self) -> list[str]:
        """이 PC의 사설 IPv4 주소(처음 한 번만 구한다)."""
        if self._addresses is None:
            try:
                self._addresses = lan_ipv4_candidates()
            except OSError:
                self._addresses = []
        return list(self._addresses)

    def recent_files(self, kind: str | None, limit: int, include_sequences: bool = False) -> dict[str, Any]:
        """전체 루트의 미디어 파일을 최신순으로. 재귀 탐색 결과는 짧게 캐시한다.

        - 종류를 지정하지 않으면 종류별 상한(RECENT_PER_KIND)만큼씩 모아 최신순으로 합친다(전체 limit까지).
        - 종류를 지정하면 그 종류만 limit까지 준다. 프레임 시퀀스는 include_sequences가 아니면 뺀다.
        반환: {"items": [...], "counts": {종류: 시퀀스를 뺀 전체 개수}, "sequences": [...]}
        """
        with self._recent_lock:
            now = time.monotonic()
            if self._recent_cache is None or now - self._recent_cache[0] > RECENT_TTL:
                everything: list[dict[str, Any]] = []
                sequences: list[dict[str, Any]] = []
                frames: list[dict[str, Any]] = []
                for rid, path in self.roots.items():
                    found, seqs, seq_files = walk_media(rid, path, None)
                    everything.extend(found)
                    sequences.extend(seqs)
                    frames.extend(seq_files)
                everything.sort(key=lambda e: e["mtime"], reverse=True)
                sequences.sort(key=lambda e: e["mtime"], reverse=True)
                self._recent_cache = (now, everything, sequences, frames)
            _, cached, sequences, frames = self._recent_cache
        counts = {k: 0 for k in RECENT_PER_KIND}
        for entry in cached:
            counts[entry["kind"]] += 1
        if kind is not None:
            pool = cached
            if include_sequences and kind == "image":
                pool = sorted(cached + frames, key=lambda e: e["mtime"], reverse=True)
            items = [e for e in pool if e["kind"] == kind][:limit]
        else:
            taken = {k: 0 for k in RECENT_PER_KIND}
            items = []
            for entry in cached:
                k = entry["kind"]
                if taken[k] < RECENT_PER_KIND[k]:
                    taken[k] += 1
                    items.append(entry)
            items = items[:limit]
        return {"items": items, "counts": counts, "sequences": sequences}

    def handle_error(self, request: Any, client_address: Any) -> None:
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError)):
            return  # 비디오 seek 등으로 클라이언트가 연결을 끊는 경우
        super().handle_error(request, client_address)


# ---------------------------------------------------------------- mDNS

class Mdns:
    """zeroconf로 sharp-vr.local 이름과 _sharpvr._tcp 서비스를 광고한다. 없으면 건너뛴다."""

    def __init__(self) -> None:
        self.zc: Any = None
        self.info: Any = None

    def start(self, ip: str, port: int) -> bool:
        try:
            from zeroconf import ServiceInfo, Zeroconf  # type: ignore
        except ImportError:
            print("[경고] zeroconf 패키지가 없어 sharp-vr.local 이름을 광고하지 않습니다.")
            print("       (BAT가 설치하지 못했다면: .venv\\Scripts\\python.exe -m pip install zeroconf  또는  uv pip install zeroconf)")
            return False
        try:
            self.zc = Zeroconf(interfaces=[ip])
            self.info = ServiceInfo(
                MDNS_SERVICE_TYPE,
                f"SHARP VR on {socket.gethostname()}.{MDNS_SERVICE_TYPE}",
                addresses=[socket.inet_aton(ip)],
                port=port,
                properties={"app": APP_ID, "version": str(API_VERSION)},
                server=f"{MDNS_HOST}.local.",
            )
            self.zc.register_service(self.info, allow_name_change=True)
            return True
        except Exception as exc:  # noqa: BLE001 - 광고 실패는 치명적이지 않다
            print(f"[경고] mDNS 광고에 실패했습니다: {exc}")
            self.close()
            return False

    def close(self) -> None:
        try:
            if self.zc is not None:
                if self.info is not None:
                    self.zc.unregister_service(self.info)
                self.zc.close()
        except Exception:  # noqa: BLE001
            pass
        self.zc = None


# ---------------------------------------------------------------- 진입점

def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Quest 3 앱용 PC 미디어 서버 (읽기 전용)")
    p.add_argument("folders", nargs="*", type=Path, help="추가로 공개할 폴더 (BAT에 드래그하면 들어옵니다)")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--probe", action="store_true", help="실기기 프로브 모드: 프로브 안내를 출력한다")
    p.add_argument("--no-mdns", action="store_true", help="sharp-vr.local 광고를 끈다")
    p.add_argument("--no-remember", action="store_true", help="드래그한 폴더를 quest_server_folders.txt에 기억하지 않는다")
    p.add_argument("--allow-origin", action="append", default=[], help="CORS를 허용할 출처를 추가한다")
    p.add_argument("--allow-host", action="append", default=[], help="Host 헤더로 허용할 이름을 추가한다 (터널 주소 등)")
    p.add_argument("-v", "--verbose", action="store_true", help="요청 로그를 출력한다")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    roots = build_roots([p for p in args.folders], remember=not args.no_remember)
    ips = lan_ipv4_candidates()
    ip = ips[0] if ips else None

    try:
        server = QuestServer(("0.0.0.0", args.port), roots, args.probe, args.verbose, set(args.allow_origin), set(args.allow_host))
    except OSError as exc:
        print(f"[오류] 포트 {args.port}을 열 수 없습니다: {exc}")
        print("       이미 서버가 실행 중이면 그 창을 닫고 다시 실행하세요.")
        return 1

    mdns = Mdns()
    if not args.no_mdns and ip:
        server.mdns_active = mdns.start(ip, args.port)

    print()
    print("=" * 64)
    print(" SHARP Quest PC 서버" + (" (프로브 모드)" if args.probe else ""))
    print("=" * 64)
    print(f" 공개 폴더 (읽기 전용):")
    for rid, path in roots.items():
        print(f"   - {rid}: {path}")
    print()
    if ip:
        print(f" PC 주소 : http://{ip}:{args.port}")
        for extra_ip in ips[1:]:
            print(f"           http://{extra_ip}:{args.port}   (다른 어댑터)")
    else:
        print(" [경고] 사설 IPv4 주소를 찾지 못했습니다. Wi-Fi/랜 연결을 확인하세요.")
    if server.mdns_active:
        print(f" mDNS 이름: http://{MDNS_HOST}.local:{args.port}")
    else:
        print(" mDNS 이름: 사용 안 함 (앱이 마지막 주소 또는 PC 주소로 연결합니다)")
    print()
    if args.probe:
        query = f"?ip={ip}" if ip else ""
        print(" [프로브] Quest 브라우저에서 다음 주소를 열고 안내에 따라 버튼을 누르세요:")
        print(f"   {PAGES_URL}probe.html{query}")
        print(" 결과는 outputs\\quest_probe_<시각>.json 으로 저장됩니다.")
    else:
        print(" Quest 앱에서 [PC] 탭을 누르세요.")
        print(f" 컨트롤러 버튼 지정(PC 브라우저): http://localhost:{args.port}/settings/bindings")
        print(" 처음 한 번만 30초쯤 걸립니다. 다음부터는 바로 연결됩니다.")
    print()
    print(" [주의] 위 공유 폴더가 같은 네트워크(Wi-Fi/랜)의 모든 기기에 읽기 전용으로 노출됩니다.")
    print("        집 같은 신뢰하는 네트워크에서만 실행하세요.")
    print()
    print(" 연결이 안 되면:")
    print("   1) Windows 방화벽 창이 뜨면 '개인 네트워크'를 허용하세요.")
    print("   2) 설정 > 네트워크 > 현재 연결의 네트워크 프로필이 '개인'인지 확인하세요.")
    print("   3) Quest와 PC가 같은 Wi-Fi(공유기)에 있어야 합니다.")
    print("   4) 앱이 자동으로 못 찾으면 [PC] 탭의 '고급: 주소 직접 입력'에 위 'PC 주소'의 숫자를 한 번만 적으세요.")
    print()
    print(" 종료: 이 창에서 Ctrl+C")
    print("=" * 64)
    sys.stdout.flush()

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        while thread.is_alive():
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        server.shutdown()
        server.server_close()
        mdns.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
