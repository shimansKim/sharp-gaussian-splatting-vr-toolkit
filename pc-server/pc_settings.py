"""SHARP PC 서버 앱의 설정·공유 폴더 목록·자동 실행·로그 파일.

표준 라이브러리만 쓴다. 파일 위치는 모두 인자로 받으므로 테스트에서 임시 폴더를 쓸 수 있다.
- settings.json      : 포트, 실행 시 관리 창 열기 (원자적으로 쓴다)
- shared_folders.txt : 이전 버전과 같은 형식(줄마다 폴더 경로, # 주석). 이 모듈은 그 파일을 읽고 고친다.
- 자동 실행          : HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
- server.log         : 크기 제한 회전 로그(창 없는 앱에서는 print가 갈 곳이 없으므로 여기로 보낸다)
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

DEFAULT_PORT = 8787
MIN_PORT = 1
MAX_PORT = 65535
DEFAULTS: dict[str, Any] = {"port": DEFAULT_PORT, "openWindowOnStart": True}

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE_BASE = "SHARP PC Server"
LOG_MAX_BYTES = 512 * 1024


def instance_suffix() -> str:
    """테스트·개발용: 환경변수로 뮤텍스·창 클래스·Run 값 이름을 분리한다(사람의 실제 앱과 겹치지 않게)."""
    return os.environ.get("SHARP_PC_SERVER_INSTANCE", "").strip()


# ---------------------------------------------------------------- 파일 쓰기

def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        with tmp.open("wb") as fh:
            fh.write(data)
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except OSError:
                pass
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------- settings.json

def validate_port(value: Any) -> int:
    """정수 포트(1~65535)만 받는다. 문자열 숫자도 받지만 bool·소수는 거절한다."""
    if isinstance(value, bool):
        raise ValueError("포트는 숫자여야 합니다.")
    if isinstance(value, str):
        text = value.strip()
        if not (text.isascii() and text.isdigit()):
            raise ValueError("포트는 숫자여야 합니다.")
        value = int(text)
    if not isinstance(value, int):
        raise ValueError("포트는 숫자여야 합니다.")
    if not MIN_PORT <= value <= MAX_PORT:
        raise ValueError(f"포트는 {MIN_PORT}~{MAX_PORT} 사이여야 합니다.")
    return value


def normalize_settings(raw: Any) -> dict[str, Any]:
    """읽은 값을 검증해 알려진 키만 남긴다. 잘못된 값은 기본값으로 되돌린다."""
    data = dict(DEFAULTS)
    if isinstance(raw, dict):
        try:
            data["port"] = validate_port(raw.get("port", DEFAULT_PORT))
        except ValueError:
            pass
        if isinstance(raw.get("openWindowOnStart"), bool):
            data["openWindowOnStart"] = raw["openWindowOnStart"]
    return data


def load_settings(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return dict(DEFAULTS)
    except (OSError, ValueError):
        # 깨진 파일은 덮어쓰기 전에 옆으로 치워 둔다.
        try:
            os.replace(path, path.with_name(path.name + ".bad"))
        except OSError:
            pass
        return dict(DEFAULTS)
    return normalize_settings(raw)


def save_settings(path: Path, data: dict[str, Any]) -> None:
    text = json.dumps(normalize_settings(data), ensure_ascii=False, indent=2) + "\n"
    atomic_write_bytes(path, text.encode("utf-8"))


class SettingsStore:
    """스레드 안전한 settings.json 보관소."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._data = load_settings(path)

    def get(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._data)

    def update(self, **changes: Any) -> dict[str, Any]:
        with self._lock:
            merged = {**self._data, **changes}
            self._data = normalize_settings(merged)
            save_settings(self.path, self._data)
            return dict(self._data)


# ---------------------------------------------------------------- shared_folders.txt

def folder_key(path: str | os.PathLike[str]) -> str:
    """같은 폴더인지 비교하는 키(대소문자·끝 구분자·.. 정규화). 존재하지 않아도 쓸 수 있다."""
    try:
        resolved = Path(path).resolve()
    except OSError:
        resolved = Path(os.path.abspath(path))
    return os.path.normcase(str(resolved))


def _read_lines(path: Path) -> list[str]:
    try:
        return path.read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError:
        return []


def _write_lines(path: Path, lines: list[str]) -> None:
    atomic_write_bytes(path, "".join(f"{line}\r\n" for line in lines).encode("utf-8"))


def list_folders(path: Path) -> list[Path]:
    """qms.read_folders_file과 같은 규칙: 빈 줄과 # 주석은 건너뛴다."""
    out: list[Path] = []
    for line in _read_lines(path):
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(Path(line))
    return out


def add_folder(path: Path, folder: Path) -> bool:
    """폴더를 목록 끝에 더한다. 이미 있으면 False."""
    key = folder_key(folder)
    lines = _read_lines(path)
    for line in lines:
        text = line.strip()
        if text and not text.startswith("#") and folder_key(text) == key:
            return False
    lines.append(str(folder))
    _write_lines(path, lines)
    return True


def remove_folder(path: Path, folder: str | os.PathLike[str]) -> bool:
    """목록에서 폴더를 뺀다(주석은 그대로 둔다). 없으면 False."""
    key = folder_key(folder)
    lines = _read_lines(path)
    kept = [line for line in lines if not (line.strip() and not line.strip().startswith("#") and folder_key(line.strip()) == key)]
    if len(kept) == len(lines):
        return False
    _write_lines(path, kept)
    return True


# ---------------------------------------------------------------- 자동 실행(레지스트리)

def run_value_name() -> str:
    return RUN_VALUE_BASE + instance_suffix()


def autostart_command(background: bool = True) -> str:
    """Run 값에 넣을 명령. 배포본은 exe, 소스 실행은 pythonw + 스크립트."""
    args = " --background" if background else ""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"{args}'
    exe = Path(sys.executable)
    pythonw = exe.with_name("pythonw.exe")
    if pythonw.is_file():
        exe = pythonw
    script = Path(sys.argv[0]).resolve() if sys.argv and sys.argv[0] else Path(__file__).resolve()
    return f'"{exe}" "{script}"{args}'


def get_autostart() -> str | None:
    """Run 값(명령 문자열). 없거나 Windows가 아니면 None."""
    if sys.platform != "win32":
        return None
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ) as key:
            value, _ = winreg.QueryValueEx(key, run_value_name())
            return str(value)
    except OSError:
        return None


def set_autostart(enabled: bool, command: str | None = None) -> None:
    if sys.platform != "win32":
        raise OSError("자동 실행은 Windows에서만 설정할 수 있습니다.")
    import winreg

    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, run_value_name(), 0, winreg.REG_SZ, command or autostart_command())
        else:
            try:
                winreg.DeleteValue(key, run_value_name())
            except FileNotFoundError:
                pass


def refresh_autostart() -> None:
    """자동 실행이 켜져 있는데 exe 위치가 바뀌었으면(다시 설치·이동) 현재 위치로 고친다."""
    current = get_autostart()
    if current is not None and current != autostart_command():
        try:
            set_autostart(True)
        except OSError:
            pass


# ---------------------------------------------------------------- 로그

class LogStream:
    """print가 갈 곳. 파일에 시각을 붙여 쓰고, 크기가 넘으면 server.log.1로 돌린다. 원래 stdout이 있으면 그쪽에도 쓴다."""

    def __init__(self, path: Path, mirror: Any = None, max_bytes: int = LOG_MAX_BYTES):
        self.path = path
        self.mirror = mirror
        self.max_bytes = max_bytes
        self._lock = threading.Lock()
        self._partial = ""
        self.encoding = "utf-8"
        self.errors = "replace"

    def isatty(self) -> bool:
        return False

    def reconfigure(self, **_kw: Any) -> None:
        pass

    def fileno(self) -> int:
        raise OSError("no fileno")

    def write(self, text: str) -> int:
        if self.mirror is not None:
            try:
                self.mirror.write(text)
            except Exception:  # noqa: BLE001 - 콘솔 쓰기 실패가 서버를 죽이면 안 된다
                pass
        with self._lock:
            self._partial += text
            *lines, self._partial = self._partial.split("\n")
            if lines:
                stamp = time.strftime("%Y-%m-%d %H:%M:%S")
                self._append("".join(f"{stamp} {line.rstrip()}\n" for line in lines if line.strip()))
        return len(text)

    def flush(self) -> None:
        if self.mirror is not None:
            try:
                self.mirror.flush()
            except Exception:  # noqa: BLE001
                pass

    def _append(self, chunk: str) -> None:
        if not chunk:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            try:
                if self.path.stat().st_size > self.max_bytes:
                    os.replace(self.path, self.path.with_name(self.path.name + ".1"))
            except OSError:
                pass
            with self.path.open("a", encoding="utf-8", newline="") as fh:
                fh.write(chunk)
        except OSError:
            pass


def install_log(path: Path) -> LogStream:
    """sys.stdout/stderr를 로그 파일로 이어 준다(원래 스트림이 있으면 그대로 두고 복사한다)."""
    stream = LogStream(path, mirror=sys.stdout)
    sys.stdout = stream  # type: ignore[assignment]
    sys.stderr = LogStream(path, mirror=sys.stderr)  # type: ignore[assignment]
    return stream
