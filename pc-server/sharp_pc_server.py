"""SHARP PC 서버 — 구매자용 Windows 배포본의 진입점.

scripts/quest_media_server.py(개발용 서버)를 그대로 쓰고, 배포본에 맞게 다음만 바꾼다.
- 설정·기록 파일은 %LOCALAPPDATA%\\SHARP PC Server\\ 에 둔다(설치 폴더에 쓰지 않는다).
- 기본 공유 폴더는 문서\\SHARP VR 이다. 처음 실행하면 만들고 탐색기로 연다.
- 공유 폴더를 고르는 창(--choose-folder)과 목록 비우기(--forget-folders)를 더한다.
- mDNS(zeroconf)는 넣지 않는다. 앱은 공유기 대역 탐색과 주소 직접 입력으로 PC를 찾는다.
- 실기기 프로브 결과 저장(POST /api/probe-result)은 --probe 일 때만 받는다.

사진→3D 변환(SHARP 모델, ml-sharp)과는 관계없는 읽기 전용 파일 서버다.
"""

from __future__ import annotations

import argparse
import os
import sys
from http import HTTPStatus
from pathlib import Path

VERSION = "1.0.0"
APP_TITLE = "SHARP PC 서버"
DATA_DIR_NAME = "SHARP PC Server"
DEFAULT_FOLDER_NAME = "SHARP VR"

FROZEN = getattr(sys, "frozen", False)
HERE = Path(__file__).resolve().parent
REPO = HERE.parent
# 배포본(PyInstaller)에서는 함께 묶은 파일이 sys._MEIPASS 아래에 있다.
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", HERE))

if not FROZEN:
    sys.path.insert(0, str(REPO / "scripts"))

import quest_media_server as qms  # noqa: E402


def data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    path = Path(base) / DATA_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def documents_dir() -> Path:
    """사용자의 '문서' 폴더(OneDrive로 옮긴 경우 포함). 못 찾으면 홈 아래 Documents."""
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
            # CSIDL_PERSONAL = 5
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:
                return Path(buf.value)
        except Exception:  # noqa: BLE001 - 못 찾으면 기본 위치를 쓴다
            pass
    return Path.home() / "Documents"


def default_folder() -> Path:
    return documents_dir() / DEFAULT_FOLDER_NAME


def resource(name: str, dev_path: Path) -> Path:
    return RESOURCE_DIR / name if FROZEN else dev_path


def configure() -> None:
    """개발용 서버의 경로 상수를 배포본 위치로 바꾼다."""
    data = data_dir()
    qms.PROJECT_ROOT = data  # 프로브 결과(outputs) 위치
    qms.FOLDERS_FILE = data / "shared_folders.txt"
    qms.BINDINGS_FILE = data / "quest_bindings.json"
    qms.BINDINGS_MODULE = resource("bindings.js", REPO / "quest-app" / "src" / "core" / "bindings.js")
    qms.BINDINGS_PAGE = resource("quest_bindings_page.html", REPO / "scripts" / "quest_bindings_page.html")
    qms.BINDINGS_PAGE_SCRIPT = resource("quest_bindings_page.js", REPO / "scripts" / "quest_bindings_page.js")


ORIGINAL_BUILD_ROOTS = qms.build_roots


def build_roots(extra: list[Path], remember: bool) -> dict[str, Path]:
    """기억한 폴더 + 이번에 받은 폴더. 하나도 없으면 기본 공유 폴더(문서\\SHARP VR)를 쓴다."""
    roots = ORIGINAL_BUILD_ROOTS(extra, remember)
    outputs = (qms.PROJECT_ROOT / "outputs").resolve()
    roots = {rid: path for rid, path in roots.items() if path != outputs}
    if not roots:
        folder = default_folder()
        folder.mkdir(parents=True, exist_ok=True)
        roots[qms.sanitize_id(folder.name)] = folder.resolve()
    return roots


def guard_probe(probe_enabled: bool) -> None:
    original = qms.QuestHandler.handle_probe_result

    def handle_probe_result(self) -> None:  # type: ignore[no-untyped-def]
        if not probe_enabled:
            self.send_error_json(HTTPStatus.NOT_FOUND, "not found")
            return
        original(self)

    qms.QuestHandler.handle_probe_result = handle_probe_result


def choose_folder_dialog(title: str) -> Path | None:
    """Windows 폴더 선택 창. 취소하면 None."""
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    class BROWSEINFOW(ctypes.Structure):
        _fields_ = [
            ("hwndOwner", wintypes.HWND),
            ("pidlRoot", ctypes.c_void_p),
            ("pszDisplayName", wintypes.LPWSTR),
            ("lpszTitle", wintypes.LPCWSTR),
            ("ulFlags", wintypes.UINT),
            ("lpfn", ctypes.c_void_p),
            ("lParam", wintypes.LPARAM),
            ("iImage", ctypes.c_int),
        ]

    shell32 = ctypes.windll.shell32
    ole32 = ctypes.windll.ole32
    shell32.SHBrowseForFolderW.restype = ctypes.c_void_p
    shell32.SHBrowseForFolderW.argtypes = [ctypes.POINTER(BROWSEINFOW)]
    shell32.SHGetPathFromIDListW.argtypes = [ctypes.c_void_p, wintypes.LPWSTR]
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    ole32.CoInitialize(None)
    display = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
    info = BROWSEINFOW()
    info.hwndOwner = ctypes.windll.kernel32.GetConsoleWindow()
    info.pszDisplayName = ctypes.cast(display, wintypes.LPWSTR)
    info.lpszTitle = title
    info.ulFlags = 0x0001 | 0x0040  # BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE
    pidl = shell32.SHBrowseForFolderW(ctypes.byref(info))
    if not pidl:
        return None
    path = ctypes.create_unicode_buffer(32768)
    ok = shell32.SHGetPathFromIDListW(pidl, path)
    ole32.CoTaskMemFree(pidl)
    return Path(path.value) if ok and path.value else None


def open_in_explorer(path: Path) -> None:
    try:
        os.startfile(str(path))  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        pass


def pause_if_double_clicked() -> None:
    """탐색기에서 두 번 눌러 연 창이 오류 메시지를 보여 주기 전에 닫히지 않게 한다."""
    if FROZEN and sys.stdin and sys.stdin.isatty():
        try:
            input("\nEnter 키를 누르면 창을 닫습니다.")
        except EOFError:
            pass


def first_run_notice(folder: Path) -> None:
    print()
    print("=" * 64)
    print(f" {APP_TITLE} {VERSION} — 처음 실행 안내")
    print("=" * 64)
    print(" Quest에서 볼 파일(PLY·영상·사진)을 아래 폴더에 넣으세요.")
    print(f"   {folder}")
    print(" 탐색기에서 이 폴더를 열어 두었습니다.")
    print()
    print(" 다른 폴더를 쓰려면:")
    print("   - 압축을 푼 폴더의 Choose-Shared-Folder.cmd 를 실행하거나")
    print("   - 폴더를 'SHARP PC Server.exe' 아이콘 위로 끌어다 놓으세요.")
    print()
    print(" 곧 Windows 방화벽 창이 뜨면 '개인 네트워크'에 체크하고 [액세스 허용]을 누르세요.")
    print("=" * 64)


def parse_own_args(argv: list[str]) -> tuple[argparse.Namespace, list[str]]:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--choose-folder", action="store_true")
    p.add_argument("--forget-folders", action="store_true")
    p.add_argument("--version", action="store_true")
    p.add_argument("--mdns", action="store_true")  # 개발용: 배포본에는 zeroconf가 없어 효과가 없다
    return p.parse_known_args(argv)


def main(argv: list[str] | None = None) -> int:
    own, rest = parse_own_args(sys.argv[1:] if argv is None else argv)
    if own.version:
        print(f"{APP_TITLE} {VERSION}")
        return 0
    if sys.platform == "win32":
        try:
            os.system(f"title {APP_TITLE} {VERSION}")
        except Exception:  # noqa: BLE001
            pass

    configure()
    qms.build_roots = build_roots
    guard_probe("--probe" in rest)

    if own.forget_folders and qms.FOLDERS_FILE.exists():
        qms.FOLDERS_FILE.unlink()
        print("기억한 공유 폴더 목록을 비웠습니다. 기본 폴더(문서\\SHARP VR)를 씁니다.")

    if own.choose_folder:
        chosen = choose_folder_dialog("Quest에서 볼 폴더를 고르세요")
        if chosen is None:
            print("폴더를 고르지 않았습니다.")
        else:
            rest.append(str(chosen))
            print(f"공유 폴더에 추가합니다: {chosen}")

    first_run = not qms.FOLDERS_FILE.exists() and not any(not a.startswith("-") for a in rest)
    if first_run:
        folder = default_folder()
        folder.mkdir(parents=True, exist_ok=True)
        if not (data_dir() / "first_run_done").exists():
            first_run_notice(folder)
            open_in_explorer(folder)
            (data_dir() / "first_run_done").write_text(VERSION, encoding="utf-8")

    if not own.mdns and "--no-mdns" not in rest:
        rest.append("--no-mdns")
    try:
        code = qms.main(rest)
    except SystemExit as exc:  # argparse 오류 등
        code = exc.code if isinstance(exc.code, int) else 1
    if code:
        pause_if_double_clicked()
    return code


if __name__ == "__main__":
    sys.exit(main())
