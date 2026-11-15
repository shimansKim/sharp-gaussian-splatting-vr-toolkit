"""SHARP PC 서버 앱의 서버 제어기와 관리 서버.

- ServerController: Quest가 접속하는 LAN 서버(QuestServer)를 켜고 끄고, 공유 폴더·포트 변경을 프로세스를 끄지 않고 반영한다.
  포트를 못 열어도 예외로 죽지 않고 error 상태와 이유를 들고 있는다.
- AdminServer: 관리 창(/settings)과 관리 API(/api/admin/*)를 127.0.0.1의 임의 포트에서만 낸다.
  LAN 포트(0.0.0.0)에는 아예 올리지 않는다. 그래도 요청마다 루프백 주소·Host·Origin·무작위 토큰을 다시 확인한다.
"""

from __future__ import annotations

import errno
import hmac
import ipaddress
import json
import os
import secrets
import threading
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

import pc_settings

TOKEN_HEADER = "X-Admin-Token"
MAX_BODY = 64 * 1024
CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


def describe_bind_error(exc: OSError, port: int) -> str:
    code = getattr(exc, "winerror", None) or exc.errno
    if code in (10048, errno.EADDRINUSE):
        return f"포트 {port}을 다른 프로그램이 쓰고 있습니다. 다른 포트를 고르거나 그 프로그램을 끝낸 뒤 [서버 다시 시작]을 누르세요."
    if code in (10013, errno.EACCES):
        return f"포트 {port}을 열 권한이 없습니다(다른 프로그램이 독점 중이거나 보안 설정 때문일 수 있습니다). 다른 포트를 고르세요."
    return f"포트 {port}을 열 수 없습니다: {exc}"


# ---------------------------------------------------------------- 서버 제어기

class ServerController:
    """LAN 서버 하나의 수명과 공유 폴더 목록을 관리한다."""

    def __init__(self, qms: Any, build_roots: Callable[[list[Path], bool], dict[str, Path]], *, probe: bool = False, verbose: bool = False,
                 origins: set[str] | None = None, hosts: set[str] | None = None, session_folders: list[Path] | None = None,
                 on_change: Callable[[], None] | None = None):
        self.qms = qms
        self.build_roots = build_roots
        self.probe = probe
        self.verbose = verbose
        self.origins = set(origins or ())
        self.hosts = set(hosts or ())
        self.session_folders = list(session_folders or [])  # --no-remember로 받은, 이번 실행에서만 쓰는 폴더
        self.on_change = on_change
        self.lock = threading.RLock()
        self.server: Any = None
        self.thread: threading.Thread | None = None
        self.port = 0
        self.error: str | None = None
        self.roots: dict[str, Path] = {}

    # -- 상태
    @property
    def running(self) -> bool:
        return self.server is not None

    def _changed(self) -> None:
        if self.on_change:
            try:
                self.on_change()
            except Exception:  # noqa: BLE001 - 알림 실패가 제어기를 깨면 안 된다
                pass

    def load_roots(self) -> dict[str, Path]:
        self.roots = self.build_roots(list(self.session_folders), False)
        return self.roots

    def _bind(self, port: int) -> Any:
        return self.qms.QuestServer(("0.0.0.0", port), self.load_roots(), self.probe, self.verbose, set(self.origins), set(self.hosts))

    def _serve(self, server: Any) -> threading.Thread:
        thread = threading.Thread(target=server.serve_forever, name="lan-server", daemon=True)
        thread.start()
        return thread

    def _close(self) -> None:
        server, thread = self.server, self.thread
        self.server = self.thread = None
        if server is not None:
            try:
                server.shutdown()
            finally:
                server.server_close()
        if thread is not None:
            thread.join(timeout=5)

    # -- 켜고 끄기
    def start(self, port: int) -> bool:
        with self.lock:
            self._close()
            self.port = port
            try:
                server = self._bind(port)
            except OSError as exc:
                self.error = describe_bind_error(exc, port)
                print(f"[오류] {self.error}")
                self._changed()
                return False
            self.server, self.thread, self.error = server, self._serve(server), None
        print(f"[서버] 포트 {port}에서 실행 중")
        self._changed()
        return True

    def stop(self) -> None:
        with self.lock:
            self._close()
            self.error = None
        self._changed()

    def restart(self) -> bool:
        return self.start(self.port)

    def apply_port(self, port: int) -> tuple[bool, str | None]:
        """포트를 바꾼다. 새 포트를 먼저 열어 보고 성공하면 옛 서버를 끈다(실패하면 옛 서버가 그대로 돈다)."""
        with self.lock:
            if port == self.port and self.running:
                return True, None
            if self.running:
                try:
                    server = self._bind(port)
                except OSError as exc:
                    return False, describe_bind_error(exc, port)
                self._close()
                self.port, self.server, self.thread, self.error = port, server, self._serve(server), None
                print(f"[서버] 포트를 {port}로 바꿨습니다")
                self._changed()
                return True, None
        ok = self.start(port)
        return ok, None if ok else self.error

    # -- 공유 폴더
    def reload_roots(self) -> None:
        """폴더 목록을 다시 읽어 실행 중인 서버에 바로 반영한다. 폴더 이름이 같아도 옛 목록 캐시를 버린다."""
        with self.lock:
            roots = self.load_roots()
            server = self.server
            if server is not None:
                server.roots = roots
                with server._list_lock:
                    server._list_cache.clear()
                with server._recent_lock:
                    server._recent_cache = None
        self._changed()

    def add_folder(self, folder: Path) -> str | None:
        """폴더를 목록에 더한다. 문제가 있으면 이유를 돌려준다."""
        try:
            resolved = folder.resolve()
        except OSError:
            return "폴더 경로를 읽을 수 없습니다."
        if not resolved.is_dir():
            return "폴더가 없습니다. 경로를 확인하세요."
        pc_settings.add_folder(self.qms.FOLDERS_FILE, resolved)
        self.reload_roots()
        return None

    def remove_folder(self, folder: str) -> bool:
        key = pc_settings.folder_key(folder)
        with self.lock:
            before = len(self.session_folders)
            self.session_folders = [p for p in self.session_folders if pc_settings.folder_key(p) != key]
            removed = len(self.session_folders) != before
        removed = pc_settings.remove_folder(self.qms.FOLDERS_FILE, folder) or removed
        if removed:
            self.reload_roots()
        return removed

    def folder_entries(self) -> list[dict[str, Any]]:
        with self.lock:
            roots = dict(self.roots)
            session = list(self.session_folders)
        by_key = {pc_settings.folder_key(path): rid for rid, path in roots.items()}
        entries: list[dict[str, Any]] = []
        seen: set[str] = set()

        def add(path: Path, kind: str) -> None:
            key = pc_settings.folder_key(path)
            if key in seen:
                return
            seen.add(key)
            entries.append({"path": str(path), "exists": path.is_dir(), "id": by_key.get(key), "kind": kind, "removable": kind != "default"})

        for path in pc_settings.list_folders(self.qms.FOLDERS_FILE):
            add(path, "saved")
        for path in session:
            add(path, "session")
        for path in roots.values():
            add(path, "default")  # 목록이 비었을 때 서버가 대신 쓰는 기본 폴더
        return entries

    def lan_urls(self) -> list[str]:
        try:
            ips = self.qms.lan_ipv4_candidates()
        except OSError:
            ips = []
        return [f"http://{ip}:{self.port}" for ip in ips]

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            state = "running" if self.running else ("error" if self.error else "stopped")
            return {"state": state, "port": self.port, "error": self.error, "probe": self.probe}

    def shared_paths(self) -> list[Path]:
        with self.lock:
            return list(self.roots.values())


# ---------------------------------------------------------------- 앱 훅

@dataclass
class AppHooks:
    """관리 서버가 앱(트레이·창)에 부탁하는 동작. 앱이 채우고 테스트는 가짜로 채운다."""

    open_window: Callable[[], None] = lambda: None
    quit: Callable[[], None] = lambda: None
    choose_folder: Callable[[], Path | None] = lambda: None
    open_in_explorer: Callable[[Path], None] = lambda path: None
    version: str = ""
    data_dir: Path | None = None
    extra: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------- 요청 검사

def is_loopback(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback


def allowed_hosts(port: int) -> set[str]:
    return {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"}


def evaluate_request(client_ip: str, host: str | None, origin: str | None, token: str | None, expected_token: str, port: int) -> tuple[int, str]:
    """(상태 코드, 이유). 200이면 통과. 루프백이 아니면 존재 자체를 숨기려고 404, 나머지는 403."""
    if not is_loopback(client_ip):
        return 404, "not found"
    if not host or host.strip().lower() not in allowed_hosts(port):
        return 403, "host not allowed"
    if origin is not None and origin.strip().lower() != f"http://{host.strip().lower()}":
        return 403, "origin not allowed"
    if not token or not hmac.compare_digest(token.encode("utf-8"), expected_token.encode("utf-8")):
        return 403, "admin token required"
    return 200, "ok"


# ---------------------------------------------------------------- 관리 서버

class AdminServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, controller: ServerController, store: pc_settings.SettingsStore, hooks: AppHooks, page: Path, script: Path, token: str | None = None):
        super().__init__(("127.0.0.1", 0), AdminHandler)
        self.controller = controller
        self.store = store
        self.hooks = hooks
        self.page = page
        self.script = script
        self.token = token or secrets.token_urlsafe(32)
        self.admin_port = self.server_address[1]
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        self.thread = threading.Thread(target=self.serve_forever, name="admin-server", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        try:
            self.shutdown()
        finally:
            self.server_close()

    def window_url(self) -> str:
        return f"http://127.0.0.1:{self.admin_port}/settings?t={self.token}"

    def state(self) -> dict[str, Any]:
        ctl = self.controller
        snap = ctl.snapshot()
        settings = self.store.get()
        autostart = pc_settings.get_autostart()
        lan = ctl.lan_urls()
        return {
            "version": self.hooks.version,
            "server": {**snap, "urls": lan, "localUrl": f"http://localhost:{snap['port']}", "bindingsUrl": f"http://localhost:{snap['port']}/settings/bindings" if snap["state"] == "running" else None},
            "folders": ctl.folder_entries(),
            "settings": {"port": settings["port"], "openWindowOnStart": settings["openWindowOnStart"], "autostart": autostart is not None},
            "defaultPort": pc_settings.DEFAULT_PORT,
            "dataDir": str(self.hooks.data_dir) if self.hooks.data_dir else None,
        }

    def handle_error(self, request: Any, client_address: Any) -> None:
        import sys

        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError)):
            return
        super().handle_error(request, client_address)


class AdminHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "SharpPcAdmin/1"

    @property
    def app(self) -> AdminServer:
        return self.server  # type: ignore[return-value]

    def log_message(self, fmt: str, *args: Any) -> None:
        pass

    # -- 응답
    def send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status: int, payload: Any) -> None:
        self.send_bytes(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def deny(self, status: int, reason: str) -> None:
        # 거절 응답에는 CORS 헤더를 붙이지 않는다. 다른 출처의 페이지가 응답을 읽을 수 없다.
        self.send_json(status, {"ok": False, "error": reason})

    def check(self, token: str | None) -> bool:
        status, reason = evaluate_request(self.client_address[0], self.headers.get("Host"), self.headers.get("Origin"), token, self.app.token, self.app.admin_port)
        if status != 200:
            self.deny(status, reason)
            return False
        return True

    # -- 메서드
    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_OPTIONS(self) -> None:  # noqa: N802
        # 관리 API는 같은 출처에서만 쓰므로 CORS 사전 요청을 받아 주지 않는다.
        self.deny(HTTPStatus.FORBIDDEN, "cross-origin requests are not allowed")

    def do_GET(self) -> None:  # noqa: N802
        try:
            parts = urlsplit(self.path)
            if parts.path == "/settings/page.js":
                if self.check_public():
                    self.serve_file(self.app.script, "text/javascript; charset=utf-8")
            elif parts.path in ("/settings", "/settings/"):
                query_token = (parse_qs(parts.query).get("t") or [None])[0]
                if self.check(query_token):
                    self.serve_file(self.app.page, "text/html; charset=utf-8")
            elif parts.path == "/api/admin/state":
                if self.check(self.headers.get(TOKEN_HEADER)):
                    self.send_json(200, {"ok": True, **self.app.state()})
            else:
                self.deny(404, "not found")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def check_public(self) -> bool:
        """토큰이 필요 없는 정적 파일(관리 페이지의 스크립트): 루프백·Host는 같은 기준으로 확인한다."""
        status, reason = evaluate_request(self.client_address[0], self.headers.get("Host"), self.headers.get("Origin"), self.app.token, self.app.token, self.app.admin_port)
        if status != 200:
            self.deny(status, reason)
            return False
        return True

    def serve_file(self, path: Path, content_type: str) -> None:
        try:
            body = path.read_bytes()
        except OSError:
            self.deny(404, f"{path.name} not found")
            return
        self.send_bytes(200, body, content_type)

    def read_json(self) -> dict[str, Any] | None:
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            self.send_json(415, {"ok": False, "error": "Content-Type must be application/json"})
            return None
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self.send_json(413, {"ok": False, "error": "body too large"})
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"ok": False, "error": "invalid json"})
            return None
        if not isinstance(data, dict):
            self.send_json(400, {"ok": False, "error": "object expected"})
            return None
        return data

    def do_POST(self) -> None:  # noqa: N802
        try:
            path = urlsplit(self.path).path
            if not path.startswith("/api/admin/"):
                self.deny(404, "not found")
                return
            if not self.check(self.headers.get(TOKEN_HEADER)):
                return
            data = self.read_json()
            if data is None:
                return
            self.route_post(path[len("/api/admin/"):], data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def fail(self, message: str, status: int = 400) -> None:
        self.send_json(status, {"ok": False, "error": message, **self.app.state()})

    def ok(self, **extra: Any) -> None:
        self.send_json(200, {"ok": True, **extra, **self.app.state()})

    def route_post(self, action: str, data: dict[str, Any]) -> None:
        app, ctl = self.app, self.app.controller
        if action == "folders/add":
            raw = data.get("path")
            if not isinstance(raw, str) or not raw.strip():
                return self.fail("폴더 경로를 적어 주세요.")
            problem = ctl.add_folder(Path(raw.strip().strip('"')))
            return self.fail(problem) if problem else self.ok()
        if action == "folders/choose":
            chosen = app.hooks.choose_folder()
            if chosen is None:
                return self.ok(cancelled=True)
            problem = ctl.add_folder(chosen)
            return self.fail(problem) if problem else self.ok(added=str(chosen))
        if action == "folders/remove":
            raw = data.get("path")
            if not isinstance(raw, str) or not ctl.remove_folder(raw):
                return self.fail("목록에 없는 폴더입니다.")
            return self.ok()
        if action == "folders/open":
            raw = data.get("path")
            known = {pc_settings.folder_key(e["path"]): e for e in ctl.folder_entries()}
            entry = known.get(pc_settings.folder_key(raw)) if isinstance(raw, str) else None
            if entry is None:
                return self.fail("목록에 없는 폴더입니다.")  # 목록 밖 경로는 열지 않는다
            if not entry["exists"]:
                return self.fail("폴더가 없습니다.")
            app.hooks.open_in_explorer(Path(entry["path"]))
            return self.ok()
        if action == "settings":
            return self.apply_settings(data)
        if action == "restart":
            ctl.restart()
            return self.ok()
        if action == "quit":
            self.ok()
            app.hooks.quit()
            return
        self.deny(404, "not found")

    def apply_settings(self, data: dict[str, Any]) -> None:
        app, ctl = self.app, self.app.controller
        changes: dict[str, Any] = {}
        if "openWindowOnStart" in data:
            if not isinstance(data["openWindowOnStart"], bool):
                return self.fail("실행 시 관리 창 열기는 켜기/끄기 값이어야 합니다.")
            changes["openWindowOnStart"] = data["openWindowOnStart"]
        if "autostart" in data:
            if not isinstance(data["autostart"], bool):
                return self.fail("자동 실행은 켜기/끄기 값이어야 합니다.")
            try:
                pc_settings.set_autostart(data["autostart"])
            except OSError as exc:
                return self.fail(f"자동 실행을 바꾸지 못했습니다: {exc}")
        error: str | None = None
        if "port" in data:
            try:
                port = pc_settings.validate_port(data["port"])
            except ValueError as exc:
                return self.fail(str(exc))
            ok, error = ctl.apply_port(port)
            if ok:
                changes["port"] = port
        if changes:
            app.store.update(**changes)
        if error:
            return self.fail(error)
        self.ok()
