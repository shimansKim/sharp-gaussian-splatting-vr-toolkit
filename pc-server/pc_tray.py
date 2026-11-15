"""Windows 트레이 아이콘·중복 실행 방지·관리 창 열기·클립보드. ctypes로 Win32를 직접 부른다(외부 패키지 없음).

트레이 창은 눈에 안 보이는 메시지 전용 창이다. 다른 스레드(관리 서버·제어기)는 PostMessageW로만 이 창에 일을 시킨다.
"""

from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import webbrowser
from ctypes import wintypes
from pathlib import Path
from typing import Callable

import pc_settings

WM_DESTROY = 0x0002
WM_CLOSE = 0x0010
WM_LBUTTONDBLCLK = 0x0203
WM_RBUTTONUP = 0x0205
WM_CONTEXTMENU = 0x007B
WM_APP = 0x8000
WM_TRAY = WM_APP + 1        # 트레이 아이콘 콜백
WM_OPEN_WINDOW = WM_APP + 2  # 관리 창 열기(두 번째 실행도 이 메시지를 보낸다)
WM_RELOAD = WM_APP + 3       # 공유 폴더 목록 다시 읽기
WM_QUIT_APP = WM_APP + 4     # 끝내기
WM_REFRESH = WM_APP + 5      # 툴팁·상태 갱신

NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 0x1, 0x2, 0x4, 0x10
NIIF_INFO, NIIF_WARNING, NIIF_ERROR = 1, 2, 3
IMAGE_ICON, LR_LOADFROMFILE, LR_DEFAULTSIZE = 1, 0x10, 0x40
IDI_APPLICATION = 32512
MF_STRING, MF_GRAYED, MF_POPUP, MF_SEPARATOR = 0x0, 0x1, 0x10, 0x800
TPM_RIGHTBUTTON, TPM_RETURNCMD, TPM_BOTTOMALIGN = 0x2, 0x100, 0x20
ERROR_ALREADY_EXISTS = 183
CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x2
SW_RESTORE = 9

ID_OPEN, ID_FOLDER, ID_COPY, ID_RESTART, ID_QUIT = 1, 2, 3, 4, 5
ID_FOLDER_BASE = 100

# 아이콘 파일 위치(packager가 pc-server/assets/app.ico 로 준다). 없으면 Windows 기본 아이콘을 쓴다.
ICON_RELATIVE = ("app.ico", "assets/app.ico")
WINDOW_TITLE_PREFIX = "Splatia PC Server 관리"
TOOLTIP_MAX = 127

if sys.platform == "win32":
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    LRESULT = wintypes.LPARAM
    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [
            ("style", wintypes.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HANDLE), ("hCursor", wintypes.HANDLE),
            ("hbrBackground", wintypes.HANDLE), ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR),
        ]

    class NOTIFYICONDATAW(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD), ("hWnd", wintypes.HWND), ("uID", wintypes.UINT), ("uFlags", wintypes.UINT),
            ("uCallbackMessage", wintypes.UINT), ("hIcon", wintypes.HANDLE), ("szTip", wintypes.WCHAR * 128),
            ("dwState", wintypes.DWORD), ("dwStateMask", wintypes.DWORD), ("szInfo", wintypes.WCHAR * 256),
            ("uVersion", wintypes.UINT), ("szInfoTitle", wintypes.WCHAR * 64), ("dwInfoFlags", wintypes.DWORD),
            ("guidItem", ctypes.c_byte * 16), ("hBalloonIcon", wintypes.HANDLE),
        ]

    class POINT(ctypes.Structure):
        _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

    def _sig(func, restype, *argtypes):
        func.restype = restype
        func.argtypes = list(argtypes)

    _sig(user32.DefWindowProcW, LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    _sig(user32.RegisterClassW, wintypes.ATOM, ctypes.POINTER(WNDCLASSW))
    _sig(user32.CreateWindowExW, wintypes.HWND, wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int, ctypes.c_int,
         ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID)
    _sig(user32.DestroyWindow, wintypes.BOOL, wintypes.HWND)
    _sig(user32.GetMessageW, ctypes.c_int, ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT)
    _sig(user32.TranslateMessage, wintypes.BOOL, ctypes.POINTER(wintypes.MSG))
    _sig(user32.DispatchMessageW, LRESULT, ctypes.POINTER(wintypes.MSG))
    _sig(user32.PostMessageW, wintypes.BOOL, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    _sig(user32.PostQuitMessage, None, ctypes.c_int)
    _sig(user32.RegisterWindowMessageW, wintypes.UINT, wintypes.LPCWSTR)
    _sig(user32.FindWindowW, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR)
    _sig(user32.LoadImageW, wintypes.HANDLE, wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int, ctypes.c_int, wintypes.UINT)
    _sig(user32.LoadIconW, wintypes.HANDLE, wintypes.HINSTANCE, wintypes.LPVOID)
    _sig(user32.CreatePopupMenu, wintypes.HMENU)
    _sig(user32.AppendMenuW, wintypes.BOOL, wintypes.HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR)
    _sig(user32.SetMenuDefaultItem, wintypes.BOOL, wintypes.HMENU, wintypes.UINT, wintypes.UINT)
    _sig(user32.DestroyMenu, wintypes.BOOL, wintypes.HMENU)
    _sig(user32.TrackPopupMenu, wintypes.BOOL, wintypes.HMENU, wintypes.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.LPVOID)
    _sig(user32.SetForegroundWindow, wintypes.BOOL, wintypes.HWND)
    _sig(user32.GetForegroundWindow, wintypes.HWND)
    _sig(user32.GetCursorPos, wintypes.BOOL, ctypes.POINTER(POINT))
    _sig(user32.OpenClipboard, wintypes.BOOL, wintypes.HWND)
    _sig(user32.CloseClipboard, wintypes.BOOL)
    _sig(user32.EmptyClipboard, wintypes.BOOL)
    _sig(user32.SetClipboardData, wintypes.HANDLE, wintypes.UINT, wintypes.HANDLE)
    _sig(user32.ShowWindow, wintypes.BOOL, wintypes.HWND, ctypes.c_int)
    _sig(user32.IsWindowVisible, wintypes.BOOL, wintypes.HWND)
    _sig(user32.GetWindowTextW, ctypes.c_int, wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    _sig(user32.EnumWindows, wintypes.BOOL, ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM), wintypes.LPARAM)
    _sig(shell32.Shell_NotifyIconW, wintypes.BOOL, wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW))
    _sig(kernel32.GetModuleHandleW, wintypes.HMODULE, wintypes.LPCWSTR)
    _sig(kernel32.CreateMutexW, wintypes.HANDLE, wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR)
    _sig(kernel32.GlobalAlloc, wintypes.HANDLE, wintypes.UINT, ctypes.c_size_t)
    _sig(kernel32.GlobalLock, ctypes.c_void_p, wintypes.HANDLE)
    _sig(kernel32.GlobalUnlock, wintypes.BOOL, wintypes.HANDLE)
    _sig(kernel32.GlobalFree, wintypes.HANDLE, wintypes.HANDLE)


def mutex_name() -> str:
    return "SHARP_PC_Server_Mutex" + pc_settings.instance_suffix()


def window_class_name() -> str:
    return "SHARPPCServerTrayWindow" + pc_settings.instance_suffix()


# ---------------------------------------------------------------- 중복 실행 방지

class SingleInstance:
    """이름 있는 뮤텍스. acquire()가 False이면 이미 다른 인스턴스가 떠 있다."""

    def __init__(self) -> None:
        self.handle = None

    def acquire(self) -> bool:
        if sys.platform != "win32":
            return True
        self.handle = kernel32.CreateMutexW(None, False, mutex_name())
        return ctypes.get_last_error() != ERROR_ALREADY_EXISTS

    def release(self) -> None:
        self.handle = None  # 프로세스가 끝나면 Windows가 뮤텍스를 닫는다


def find_running_window(retries: int = 20, delay: float = 0.25) -> int | None:
    """실행 중인 인스턴스의 숨은 창. 막 뜨는 중일 수 있어 잠깐 기다린다."""
    import time

    if sys.platform != "win32":
        return None
    for _ in range(retries):
        hwnd = user32.FindWindowW(window_class_name(), None)
        if hwnd:
            return int(hwnd)
        time.sleep(delay)
    return None


def post_to_running(message: int, retries: int = 20) -> bool:
    hwnd = find_running_window(retries)
    return bool(hwnd) and bool(user32.PostMessageW(hwnd, message, 0, 0))


# ---------------------------------------------------------------- 클립보드·창·탐색기

def copy_to_clipboard(text: str, hwnd: int | None = None) -> bool:
    if sys.platform != "win32":
        return False
    data = ctypes.create_unicode_buffer(text)
    size = ctypes.sizeof(data)
    if not user32.OpenClipboard(hwnd):
        return False
    try:
        user32.EmptyClipboard()
        handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
        if not handle:
            return False
        locked = kernel32.GlobalLock(handle)
        if not locked:
            kernel32.GlobalFree(handle)
            return False
        ctypes.memmove(locked, ctypes.addressof(data), size)
        kernel32.GlobalUnlock(handle)
        if not user32.SetClipboardData(CF_UNICODETEXT, handle):
            kernel32.GlobalFree(handle)
            return False
        return True  # 성공하면 handle의 소유권은 클립보드로 넘어간다
    finally:
        user32.CloseClipboard()


def foreground_window() -> int:
    return int(user32.GetForegroundWindow() or 0) if sys.platform == "win32" else 0


def focus_existing_window(title_prefix: str = WINDOW_TITLE_PREFIX) -> bool:
    """이미 열린 관리 창이 있으면 앞으로 가져온다(창이 여러 개 쌓이지 않게)."""
    if sys.platform != "win32":
        return False
    found: list[int] = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def visit(hwnd: int, _lparam: int) -> bool:
        if user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, buf, 256)
            if buf.value.startswith(title_prefix):
                found.append(int(hwnd))
        return True

    user32.EnumWindows(callback_type(visit), 0)
    if not found:
        return False
    user32.ShowWindow(found[0], SW_RESTORE)
    user32.SetForegroundWindow(found[0])
    return True


def find_edge() -> Path | None:
    names = ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")
    for env in names:
        base = os.environ.get(env)
        if base:
            candidate = Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            if candidate.is_file():
                return candidate
    return None


def open_url_as_app(url: str, width: int = 1020, height: int = 800) -> None:
    """Edge가 있으면 테두리만 있는 앱 창으로, 없으면 기본 브라우저로 연다."""
    edge = find_edge()
    if edge is not None:
        try:
            subprocess.Popen([str(edge), f"--app={url}", f"--window-size={width},{height}"], close_fds=True,
                             creationflags=0x00000008 | 0x00000200)  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            return
        except OSError:
            pass
    webbrowser.open(url)


def open_in_explorer(path: Path) -> None:
    try:
        os.startfile(str(path))  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        pass


def find_icon_file(resource_dir: Path, exe_dir: Path) -> Path | None:
    for base in (resource_dir, exe_dir):
        for rel in ICON_RELATIVE:
            candidate = base / rel
            if candidate.is_file():
                return candidate
    return None


# ---------------------------------------------------------------- 트레이

class Tray:
    """보이지 않는 창 + 알림 영역 아이콘. run()이 메시지 루프를 돌며 끝낼 때까지 돌아오지 않는다."""

    def __init__(self, *, title: str, icon_path: Path | None, tooltip: Callable[[], str], folders: Callable[[], list[Path]],
                 address: Callable[[], str], on_open: Callable[[], None], on_reload: Callable[[], None], on_restart: Callable[[], None],
                 on_quit_cleanup: Callable[[], None]):
        self.title = title
        self.icon_path = icon_path
        self.tooltip = tooltip
        self.folders = folders
        self.address = address
        self.on_open, self.on_reload, self.on_restart = on_open, on_reload, on_restart
        self.on_quit_cleanup = on_quit_cleanup
        self.hwnd = 0
        self.icon = None
        self.taskbar_created = user32.RegisterWindowMessageW("TaskbarCreated")
        self._proc = WNDPROC(self._wndproc)  # 참조를 붙들어 두지 않으면 수거되어 죽는다
        self._menu_folders: list[Path] = []

    # -- 스레드 안전: 다른 스레드는 이것만 부른다
    def post(self, message: int) -> None:
        if self.hwnd:
            user32.PostMessageW(self.hwnd, message, 0, 0)

    def _load_icon(self):
        if self.icon_path is not None:
            icon = user32.LoadImageW(None, str(self.icon_path), IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE)
            if icon:
                return icon
        return user32.LoadIconW(None, ctypes.c_void_p(IDI_APPLICATION))

    def _data(self, flags: int) -> NOTIFYICONDATAW:
        data = NOTIFYICONDATAW()
        data.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        data.hWnd = self.hwnd
        data.uID = 1
        data.uFlags = flags
        data.uCallbackMessage = WM_TRAY
        data.hIcon = self.icon
        data.szTip = self.tooltip()[:TOOLTIP_MAX]
        return data

    def _add_icon(self) -> None:
        shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(self._data(NIF_MESSAGE | NIF_ICON | NIF_TIP)))

    def refresh(self) -> None:
        shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(self._data(NIF_MESSAGE | NIF_ICON | NIF_TIP)))

    def balloon(self, title: str, text: str, level: int = NIIF_INFO) -> None:
        data = self._data(NIF_INFO)
        data.szInfoTitle = title[:63]
        data.szInfo = text[:255]
        data.dwInfoFlags = level
        shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(data))

    def _remove_icon(self) -> None:
        shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._data(0)))

    # -- 메뉴
    def _show_menu(self) -> None:
        menu = user32.CreatePopupMenu()
        sub = None
        self._menu_folders = self.folders()
        user32.AppendMenuW(menu, MF_STRING, ID_OPEN, "관리 창 열기")
        if len(self._menu_folders) > 1:
            sub = user32.CreatePopupMenu()
            for i, folder in enumerate(self._menu_folders):
                user32.AppendMenuW(sub, MF_STRING, ID_FOLDER_BASE + i, str(folder).replace("&", "&&"))
            user32.AppendMenuW(menu, MF_POPUP, int(sub or 0), "공유 폴더 열기")
        else:
            user32.AppendMenuW(menu, MF_STRING | (0 if self._menu_folders else MF_GRAYED), ID_FOLDER, "공유 폴더 열기")
        user32.AppendMenuW(menu, MF_STRING, ID_COPY, "PC 주소 복사")
        user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
        user32.AppendMenuW(menu, MF_STRING, ID_RESTART, "서버 다시 시작")
        user32.AppendMenuW(menu, MF_STRING, ID_QUIT, "끝내기")
        user32.SetMenuDefaultItem(menu, ID_OPEN, False)
        point = POINT()
        user32.GetCursorPos(ctypes.byref(point))
        user32.SetForegroundWindow(self.hwnd)  # 이걸 안 하면 메뉴 밖을 눌러도 메뉴가 안 닫힌다
        command = user32.TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_BOTTOMALIGN, point.x, point.y, 0, self.hwnd, None)
        user32.PostMessageW(self.hwnd, 0, 0, 0)  # WM_NULL: 메뉴 닫힘 처리 관례
        user32.DestroyMenu(menu)
        if command:
            self._command(int(command))

    def _command(self, command: int) -> None:
        if command == ID_OPEN:
            self.on_open()
        elif command == ID_FOLDER and self._menu_folders:
            open_in_explorer(self._menu_folders[0])
        elif command >= ID_FOLDER_BASE and command - ID_FOLDER_BASE < len(self._menu_folders):
            open_in_explorer(self._menu_folders[command - ID_FOLDER_BASE])
        elif command == ID_COPY:
            if copy_to_clipboard(self.address(), self.hwnd):
                self.balloon("PC 주소를 복사했습니다", self.address())
        elif command == ID_RESTART:
            self.on_restart()
        elif command == ID_QUIT:
            user32.DestroyWindow(self.hwnd)

    # -- 메시지 처리
    def _wndproc(self, hwnd, msg, wparam, lparam):  # noqa: ANN001
        try:
            if msg == WM_TRAY:
                if lparam == WM_LBUTTONDBLCLK:
                    self.on_open()
                elif lparam in (WM_RBUTTONUP, WM_CONTEXTMENU):
                    self._show_menu()
                return 0
            if msg == WM_OPEN_WINDOW:
                self.on_open()
                return 0
            if msg == WM_RELOAD:
                self.on_reload()
                return 0
            if msg == WM_REFRESH:
                self.refresh()
                return 0
            if msg in (WM_QUIT_APP, WM_CLOSE):
                user32.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
                self._remove_icon()
                user32.PostQuitMessage(0)
                return 0
            if self.taskbar_created and msg == self.taskbar_created:
                self._add_icon()  # 탐색기가 다시 시작되면 아이콘을 다시 넣는다
                return 0
        except Exception as exc:  # noqa: BLE001 - 창 프로시저에서 예외가 새면 프로세스가 죽는다
            print(f"[오류] 트레이 처리 중 예외: {exc!r}")
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def create(self) -> None:
        instance = kernel32.GetModuleHandleW(None)
        wc = WNDCLASSW()
        wc.lpfnWndProc = self._proc
        wc.hInstance = instance
        wc.lpszClassName = window_class_name()
        if not user32.RegisterClassW(ctypes.byref(wc)):
            raise OSError(f"창 클래스 등록 실패: {ctypes.get_last_error()}")
        # 메시지 전용 창(HWND_MESSAGE = -3)은 FindWindow로 찾을 수 없으므로 일반 숨은 창을 만든다.
        self.hwnd = user32.CreateWindowExW(0, window_class_name(), self.title, 0, 0, 0, 0, 0, None, None, instance, None)
        if not self.hwnd:
            raise OSError(f"트레이 창 만들기 실패: {ctypes.get_last_error()}")
        self.icon = self._load_icon()
        self._add_icon()

    def run(self) -> None:
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
        self.on_quit_cleanup()
