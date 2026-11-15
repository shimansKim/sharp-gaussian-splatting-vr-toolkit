"""SHARP PC 서버 — 구매자용 Windows 배포본의 진입점.

scripts/quest_media_server.py(개발용 서버)를 그대로 쓰고, 배포본에 맞게 다음을 더한다.
- 기본 실행은 콘솔 없는 트레이 앱이다. 관리 창(/settings)은 127.0.0.1의 임의 포트에서만 열리고 LAN 포트에는 올리지 않는다(pc_admin.py).
- --console 은 예전처럼 콘솔 창에서 서버만 돌리고, --headless 는 트레이·창 없이 돈다(빌드 smoke).
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
import threading
from http import HTTPStatus
from pathlib import Path
from typing import Any

VERSION = "1.1.0"
APP_TITLE = "SHARP PC 서버"
DATA_DIR_NAME = "SHARP PC Server"
DEFAULT_FOLDER_NAME = "SHARP VR"
SETTINGS_NAME = "settings.json"
LOG_NAME = "server.log"

FROZEN = getattr(sys, "frozen", False)
HERE = Path(__file__).resolve().parent
REPO = HERE.parent
# 배포본(PyInstaller)에서는 함께 묶은 파일이 sys._MEIPASS 아래에 있다.
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", HERE))

if not FROZEN:
    sys.path.insert(0, str(REPO / "scripts"))

import quest_media_server as qms  # noqa: E402

sys.path.insert(0, str(HERE))  # 같은 폴더의 pc_*.py (소스 실행·테스트에서 어디서 불러도 찾도록)
import pc_admin  # noqa: E402
import pc_settings  # noqa: E402
import pc_tray  # noqa: E402


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
    qms.BINDINGS_MODULE = resource("bindings.js", REPO / "pc-server" / "bindings.js")
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


def choose_folder_dialog(title: str, owner: int | None = None) -> Path | None:
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
    info.hwndOwner = owner or ctypes.windll.kernel32.GetConsoleWindow()  # 관리 창에서 부르면 그 창 위에 뜨게 한다
    info.pszDisplayName = ctypes.cast(display, wintypes.LPWSTR)
    info.lpszTitle = title
    info.ulFlags = 0x0001 | 0x0040  # BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE
    try:
        pidl = shell32.SHBrowseForFolderW(ctypes.byref(info))
        if not pidl:
            return None
        path = ctypes.create_unicode_buffer(32768)
        ok = shell32.SHGetPathFromIDListW(pidl, path)
        ole32.CoTaskMemFree(pidl)
        return Path(path.value) if ok and path.value else None
    finally:
        ole32.CoUninitialize()


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
    p.add_argument("--console", action="store_true")  # 예전처럼 콘솔 창에서 서버만 돌린다(트레이·관리 창 없음)
    p.add_argument("--headless", action="store_true")  # 트레이·창 없이 서버+관리 서버만 돌린다(빌드 smoke·진단용)
    p.add_argument("--background", action="store_true")  # 자동 실행용: 관리 창을 열지 않고 트레이에만 둔다
    p.add_argument("--quit", action="store_true")  # 실행 중인 앱에 종료를 요청한다(설치·제거 프로그램용)
    p.add_argument("--print-admin-url", action="store_true")  # 개발·테스트용: 관리 창 주소(토큰 포함)를 stdout에 찍는다
    return p.parse_known_args(argv)


def fix_output_encoding() -> None:
    """콘솔이 아닌 곳(파이프·파일)으로 출력할 때 시스템 코드 페이지가 한글을 못 써서 죽지 않게 한다."""
    for stream in (sys.stdout, sys.stderr):
        if stream is None or not hasattr(stream, "reconfigure"):
            continue
        try:
            if stream.isatty():
                stream.reconfigure(errors="replace")
            else:
                stream.reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass


def explicit_port(rest: list[str]) -> bool:
    return any(a == "--port" or a.startswith("--port=") for a in rest)


def tooltip_text(ctl: pc_admin.ServerController) -> str:
    snap = ctl.snapshot()
    if snap["state"] == "running":
        return f"{APP_TITLE} — 실행 중 (포트 {snap['port']})"
    if snap["state"] == "error":
        return f"{APP_TITLE} — 오류: 포트 {snap['port']}을 열 수 없음"
    return f"{APP_TITLE} — 중지됨"


def hand_off_to_running(args: argparse.Namespace, own: argparse.Namespace) -> int:
    """이미 떠 있는 앱이 있다. 폴더 인자는 목록에 기억시키고, 그 앱의 관리 창을 열게 한 뒤 끝낸다."""
    if args.folders and not args.no_remember:
        for folder in args.folders:
            if folder.is_dir():
                pc_settings.add_folder(qms.FOLDERS_FILE, folder.resolve())
        pc_tray.post_to_running(pc_tray.WM_RELOAD)
    elif args.folders:
        print("[안내] 이미 실행 중인 앱에는 --no-remember 폴더를 넘길 수 없습니다. 관리 창에서 추가하세요.")
    if not own.background:
        pc_tray.post_to_running(pc_tray.WM_OPEN_WINDOW)
    print("[안내] SHARP PC 서버가 이미 실행 중입니다. 기존 앱의 관리 창을 엽니다.")
    return 0


def quit_running() -> int:
    if sys.platform == "win32" and pc_tray.post_to_running(pc_tray.WM_QUIT_APP, retries=1):
        print("실행 중인 SHARP PC 서버에 종료를 요청했습니다.")
        return 0
    print("실행 중인 SHARP PC 서버가 없습니다.")
    return 1


def run_app(own: argparse.Namespace, rest: list[str]) -> int:
    """트레이 앱(기본) 또는 --headless. 설정·로그는 %LOCALAPPDATA%\\SHARP PC Server 에 둔다."""
    pc_settings.install_log(data_dir() / LOG_NAME)
    if "--no-mdns" not in rest:
        rest.append("--no-mdns")
    try:
        args = qms.parse_args(rest)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2

    headless = own.headless or sys.platform != "win32"
    single = pc_tray.SingleInstance()
    if not headless and not single.acquire():
        return hand_off_to_running(args, own)

    store = pc_settings.SettingsStore(data_dir() / SETTINGS_NAME)
    port = args.port if explicit_port(rest) else store.get()["port"]
    if not args.no_remember and args.folders:
        build_roots(list(args.folders), True)  # 넘겨받은 폴더를 shared_folders.txt에 기억시킨다
    session = list(args.folders) if args.no_remember else []
    if not headless:
        try:
            pc_settings.refresh_autostart()
        except Exception as exc:  # noqa: BLE001 - 자동 실행 값 보정 실패는 치명적이지 않다
            print(f"[경고] 자동 실행 값을 확인하지 못했습니다: {exc}")

    holder: dict[str, Any] = {"tray": None}
    quit_event = threading.Event()

    def changed() -> None:
        tray = holder["tray"]
        if tray is not None:
            tray.post(pc_tray.WM_REFRESH)

    ctl = pc_admin.ServerController(qms, build_roots, probe=args.probe, verbose=args.verbose, origins=set(args.allow_origin),
                                    hosts=set(args.allow_host), session_folders=session, on_change=changed)

    def request_quit() -> None:
        tray = holder["tray"]
        if tray is not None:
            tray.post(pc_tray.WM_QUIT_APP)
        quit_event.set()

    hooks = pc_admin.AppHooks(
        quit=request_quit,
        choose_folder=lambda: choose_folder_dialog("Quest에서 볼 폴더를 고르세요", owner=pc_tray.foreground_window() if not headless else None),
        open_in_explorer=open_in_explorer,
        version=VERSION,
        data_dir=data_dir(),
    )
    admin = pc_admin.AdminServer(ctl, store, hooks, resource("settings_page.html", HERE / "settings_page.html"),
                                 resource("settings_page.js", HERE / "settings_page.js"))

    def open_window() -> None:
        if pc_tray.focus_existing_window():
            return
        pc_tray.open_url_as_app(admin.window_url())

    hooks.open_window = open_window

    def cleanup() -> None:
        admin.stop()
        ctl.stop()
        print("[서버] 종료했습니다")

    started = ctl.start(port)
    admin.start()
    if own.print_admin_url:
        # 토큰이 들어 있으므로 로그 파일로 복사되지 않게 원래 stdout에만 쓴다.
        if sys.__stdout__ is not None:
            sys.__stdout__.write(f"ADMIN_URL={admin.window_url()}" + chr(10))
            sys.__stdout__.flush()

    if headless:
        print(f"[앱] 창 없이 실행 중 (포트 {ctl.port}, 관리 포트 {admin.admin_port})")
        try:
            while not quit_event.wait(0.5):
                pass
        except KeyboardInterrupt:
            pass
        finally:
            cleanup()
        return 0 if started else 1

    tray = pc_tray.Tray(
        title=f"{APP_TITLE} {VERSION}",
        icon_path=pc_tray.find_icon_file(RESOURCE_DIR, Path(sys.executable).parent if FROZEN else HERE),
        tooltip=lambda: tooltip_text(ctl),
        folders=ctl.shared_paths,
        address=lambda: (ctl.lan_urls() or [f"http://localhost:{ctl.port}"])[0],
        on_open=open_window,
        on_reload=ctl.reload_roots,
        on_restart=lambda: tray_restart(tray, ctl),
        on_quit_cleanup=cleanup,
    )
    holder["tray"] = tray
    tray.create()
    if not started:
        tray.balloon("서버를 시작하지 못했습니다", ctl.error or "", pc_tray.NIIF_ERROR)
    if not own.background and (store.get()["openWindowOnStart"] or not started):
        tray.post(pc_tray.WM_OPEN_WINDOW)
    tray.run()
    return 0


def tray_restart(tray: "pc_tray.Tray", ctl: pc_admin.ServerController) -> None:
    if ctl.restart():
        tray.balloon(APP_TITLE, f"서버를 다시 시작했습니다 (포트 {ctl.port})")
    else:
        tray.balloon("서버를 시작하지 못했습니다", ctl.error or "", pc_tray.NIIF_ERROR)


def run_console(own: argparse.Namespace, rest: list[str]) -> int:
    """예전 방식: 콘솔 창에서 서버만 돌린다(--console)."""
    if sys.platform == "win32":
        try:
            os.system(f"title {APP_TITLE} {VERSION}")
        except Exception:  # noqa: BLE001
            pass
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


def main(argv: list[str] | None = None) -> int:
    fix_output_encoding()
    own, rest = parse_own_args(sys.argv[1:] if argv is None else argv)
    if own.version:
        print(f"{APP_TITLE} {VERSION}")
        return 0
    if own.quit:
        return quit_running()

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

    if own.console:
        return run_console(own, rest)
    return run_app(own, rest)


if __name__ == "__main__":
    sys.exit(main())
