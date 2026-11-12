"""SHARP PC 서버 Windows 배포본(zip)을 만든다.

    python pc-server/build.py            # dist/pc-server/ 에 zip과 pc-server.json
    python pc-server/build.py --smoke    # 만든 exe를 띄워 /api/info 확인까지

GitHub Actions(.github/workflows/pc-server.yml)가 windows-latest에서 같은 명령을 부른다.
PyInstaller 단일 폴더(onedir) 방식이다. 압축을 풀면 Python 설치 없이 실행된다.
사진→3D 변환(SHARP 모델·ml-sharp)과 zeroconf(LGPL)는 넣지 않으며, 들어가면 빌드를 멈춘다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "scripts"))

import sharp_pc_server  # noqa: E402

VERSION = sharp_pc_server.VERSION
EXE_NAME = "SHARP PC Server"
DIST_NAME = f"SHARP-PC-Server-{VERSION}-win64"
OUT = REPO / "dist" / "pc-server"
WORK = REPO / "build" / "pc-server"
CRLF = "\r\n"

# 배포본에 들어가면 안 되는 것(이름 일부, 소문자). 비상업 라이선스 모델·변환 도구, LGPL 라이브러리.
FORBIDDEN = ("torch", "ml_sharp", "ml-sharp", "sharp_model", "safetensors", "gsplat", "zeroconf", "ifaddr", "tkinter", "_tkinter", "tcl", "tk86", "libssl", "libcrypto")

DATA_FILES = {
    "bindings.js": REPO / "quest-app" / "src" / "core" / "bindings.js",
    "quest_bindings_page.html": REPO / "scripts" / "quest_bindings_page.html",
    "quest_bindings_page.js": REPO / "scripts" / "quest_bindings_page.js",
}

# 서버가 쓰지 않는 모듈. 특히 ssl(OpenSSL)·bz2·lzma·_decimal은 표준 라이브러리가 없을 때 알아서 건너뛰므로 빼서 크기와 고지 대상을 줄인다.
EXCLUDES = [
    "zeroconf", "ifaddr", "tkinter", "_tkinter", "unittest", "pydoc", "doctest", "lib2to3", "test", "sqlite3", "xmlrpc", "pdb",
    "ssl", "_ssl", "_hashlib", "bz2", "_bz2", "lzma", "_lzma", "_decimal",
]


def run(cmd: list[str], **kw) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, **kw)


def write_crlf(path: Path, text: str) -> None:
    path.write_bytes(text.replace("\r\n", "\n").replace("\n", CRLF).encode("utf-8"))


def pyinstaller() -> Path:
    shutil.rmtree(WORK, ignore_errors=True)
    shutil.rmtree(OUT, ignore_errors=True)
    sep = ";" if os.name == "nt" else ":"
    cmd = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--console",
        "--name", EXE_NAME,
        "--distpath", str(WORK / "dist"), "--workpath", str(WORK / "work"), "--specpath", str(WORK),
        "--paths", str(REPO / "scripts"),
        "--hidden-import", "quest_media_server",
    ]
    for name, src in DATA_FILES.items():
        cmd += ["--add-data", f"{src}{sep}."]
    for mod in EXCLUDES:
        cmd += ["--exclude-module", mod]
    cmd.append(str(HERE / "sharp_pc_server.py"))
    run(cmd)
    return WORK / "dist" / EXE_NAME


def pyinstaller_license() -> Path | None:
    import PyInstaller  # noqa: PLC0415

    base = Path(PyInstaller.__file__).resolve().parent
    for candidate in [base / "COPYING.txt", *base.parent.glob("pyinstaller-*.dist-info/**/COPYING.txt")]:
        if candidate.is_file():
            return candidate
    return None


def add_extras(app: Path) -> None:
    lic = app / "licenses"
    lic.mkdir(exist_ok=True)
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
    if not python_license.is_file():
        raise SystemExit(f"Python 라이선스 파일이 없습니다: {python_license}")
    shutil.copy2(python_license, lic / "Python-LICENSE.txt")
    pyi = pyinstaller_license()
    if not pyi:
        raise SystemExit("PyInstaller 라이선스(COPYING.txt)를 찾지 못했습니다.")
    shutil.copy2(pyi, lic / "PyInstaller-COPYING.txt")
    write_crlf(lic / "NOTICE.txt", (HERE / "NOTICE.txt").read_text(encoding="utf-8").replace("{python}", sys.version.split()[0]))
    write_crlf(app / "README.txt", (HERE / "README.txt").read_text(encoding="utf-8").replace("{version}", VERSION))
    write_crlf(app / "Choose-Shared-Folder.cmd", f'@echo off\n"%~dp0{EXE_NAME}.exe" --choose-folder %*\n')
    write_crlf(app / "Reset-Shared-Folders.cmd", f'@echo off\n"%~dp0{EXE_NAME}.exe" --forget-folders %*\n')


def check_contents(app: Path) -> None:
    bad = [str(p.relative_to(app)) for p in app.rglob("*") if any(word in p.name.lower() for word in FORBIDDEN)]
    if bad:
        raise SystemExit("배포본에 들어가면 안 되는 파일이 있습니다:\n  " + "\n  ".join(bad))
    for name in DATA_FILES:
        if not list(app.rglob(name)):
            raise SystemExit(f"{name}이 배포본에 없습니다.")


def make_zip(app: Path) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{DIST_NAME}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(app.rglob("*")):
            if path.is_file():
                zf.write(path, f"{DIST_NAME}/{path.relative_to(app).as_posix()}")
    return target


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def smoke(app: Path) -> None:
    """exe를 다른 포트로 띄워 /api/info·/api/list·/settings/bindings가 응답하는지 본다."""
    exe = app / f"{EXE_NAME}.exe"
    port = free_port()
    with tempfile.TemporaryDirectory() as tmp:
        shared = Path(tmp) / "shared"
        shared.mkdir()
        (shared / "sample.ply").write_bytes(b"ply\nformat binary_little_endian 1.0\nend_header\n")
        env = {**os.environ, "LOCALAPPDATA": str(Path(tmp) / "appdata")}
        proc = subprocess.Popen([str(exe), "--port", str(port), "--no-remember", str(shared)], env=env,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            base = f"http://127.0.0.1:{port}"
            info = None
            for _ in range(60):
                try:
                    with urllib.request.urlopen(base + "/api/info", timeout=2) as r:
                        info = json.loads(r.read().decode("utf-8"))
                    break
                except OSError:
                    if proc.poll() is not None:
                        break
                    time.sleep(0.5)
            if not info:
                out = proc.stdout.read().decode("utf-8", "replace") if proc.poll() is not None else ""
                raise SystemExit(f"exe가 /api/info에 응답하지 않습니다.\n{out}")
            print("api/info:", json.dumps(info, ensure_ascii=False))
            root = info["roots"][0]["id"] if isinstance(info.get("roots"), list) and info["roots"] and isinstance(info["roots"][0], dict) else None
            if root:
                with urllib.request.urlopen(f"{base}/api/list?root={root}", timeout=5) as r:
                    listing = json.loads(r.read().decode("utf-8"))
                names = [item.get("name") for item in listing.get("items", [])]
                print("api/list:", names)
                if "sample.ply" not in names:
                    raise SystemExit("공유 폴더의 파일이 목록에 없습니다.")
            with urllib.request.urlopen(base + "/settings/bindings.js", timeout=5) as r:
                if r.status != 200:
                    raise SystemExit("/settings/bindings.js 응답 실패")
            print("smoke ok")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    app = pyinstaller()
    add_extras(app)
    check_contents(app)
    if args.smoke:
        smoke(app)
    archive = make_zip(app)
    meta = {
        "name": "SHARP PC Server",
        "version": VERSION,
        "file": archive.name,
        "size": archive.stat().st_size,
        "sha256": sha256(archive),
        "python": sys.version.split()[0],
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": os.environ.get("GITHUB_SHA", "")[:7],
    }
    (OUT / "pc-server.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
