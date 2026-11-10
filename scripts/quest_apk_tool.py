"""Quest 3용 TWA APK 빌드·설치 도구 (표준 라이브러리만 사용).

  python scripts/quest_apk_tool.py build     # Bubblewrap으로 APK 빌드 + 서명 + assetlinks 내용 출력
  python scripts/quest_apk_tool.py install   # adb로 Quest에 설치
  python scripts/quest_apk_tool.py fingerprint

보통은 build_quest_apk.bat / install_quest_app.bat가 이 파일을 부른다.
APK는 Pages 주소(https://shimanskim.github.io/sharp-gaussian-splatting-vr-toolkit/)를 여는 껍데기라서
웹 코드를 고쳐도 다시 설치할 필요가 없다. 서명 키는 저장소 밖 %USERPROFILE%\\.sharp-quest\\ 에 둔다.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import string
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOME = Path(os.environ.get("USERPROFILE") or Path.home())
KEY_DIR = HOME / ".sharp-quest"
KEYSTORE = KEY_DIR / "sharp-quest.keystore"
PASSWORD_FILE = KEY_DIR / "keystore-password.txt"
BUILD_DIR = KEY_DIR / "twa-build"
OUT_DIR = REPO / "outputs" / "quest_app"
APK_OUT = OUT_DIR / "sharp-quest-viewer.apk"
ASSETLINKS_OUT = OUT_DIR / "assetlinks.json"
TWA_MANIFEST = REPO / "twa" / "twa-manifest.json"
BUBBLEWRAP_PACKAGE = "@meta-quest/bubblewrap-cli@1.24.1"
BUBBLEWRAP_CONFIG = HOME / ".bubblewrap" / "config.json"
PLATFORM_TOOLS_URL = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
ALIAS = "sharpquest"


def say(message: str = "") -> None:
    print(message, flush=True)


def fail(message: str) -> "None":
    say()
    say(f"[실패] {message}")
    sys.exit(1)


def run(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None, capture: bool = False) -> subprocess.CompletedProcess:
    merged = {**os.environ, **(env or {})}
    return subprocess.run(command, cwd=cwd, env=merged, text=True, encoding="utf-8", errors="replace", capture_output=capture)


# ---------------------------------------------------------------- 키

def ensure_password() -> str:
    KEY_DIR.mkdir(parents=True, exist_ok=True)
    if PASSWORD_FILE.exists():
        return PASSWORD_FILE.read_text(encoding="utf-8").strip()
    alphabet = string.ascii_letters + string.digits
    password = "".join(secrets.choice(alphabet) for _ in range(24))
    PASSWORD_FILE.write_text(password + "\n", encoding="utf-8")
    return password


def find_keytool() -> Path | None:
    on_path = shutil.which("keytool")
    if on_path:
        return Path(on_path)
    if BUBBLEWRAP_CONFIG.exists():
        try:
            jdk = Path(json.loads(BUBBLEWRAP_CONFIG.read_text(encoding="utf-8")).get("jdkPath", ""))
        except (OSError, ValueError):
            jdk = Path()
        for candidate in (jdk / "bin" / "keytool.exe", jdk / "Contents" / "Home" / "bin" / "keytool.exe"):
            if candidate.exists():
                return candidate
    return None


def ensure_keystore(password: str) -> None:
    if KEYSTORE.exists():
        return
    keytool = find_keytool()
    if not keytool:
        fail("keytool(JDK)을 찾지 못했습니다. Bubblewrap이 JDK를 받은 뒤 다시 실행하세요.")
    say("서명 키를 새로 만듭니다(처음 한 번만).")
    result = run(
        [
            str(keytool), "-genkeypair", "-keystore", str(KEYSTORE), "-alias", ALIAS,
            "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
            "-storepass", password, "-keypass", password,
            "-dname", "CN=SHARP Quest Viewer, O=shimansKim, C=KR",
        ],
        capture=True,
    )
    if result.returncode != 0:
        fail(f"서명 키를 만들지 못했습니다.\n{result.stdout}\n{result.stderr}")
    say(f"  키 파일: {KEYSTORE}")
    say(f"  비밀번호 파일: {PASSWORD_FILE}")
    say("  이 두 파일을 꼭 백업하세요. 잃어버리면 같은 앱을 업데이트할 수 없습니다.")


def sha256_fingerprint(password: str) -> str:
    keytool = find_keytool()
    if not keytool or not KEYSTORE.exists():
        fail("서명 키가 없습니다. 먼저 build를 실행하세요.")
    result = run([str(keytool), "-list", "-v", "-keystore", str(KEYSTORE), "-alias", ALIAS, "-storepass", password], capture=True)
    match = re.search(r"SHA-?256:\s*((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})", result.stdout)
    if result.returncode != 0 or not match:
        fail(f"지문을 읽지 못했습니다.\n{result.stdout}\n{result.stderr}")
    return match.group(1).upper()


def write_assetlinks(fingerprint: str) -> Path:
    package_id = json.loads(TWA_MANIFEST.read_text(encoding="utf-8"))["packageId"]
    data = [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {"namespace": "android_app", "package_name": package_id, "sha256_cert_fingerprints": [fingerprint]},
        }
    ]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSETLINKS_OUT.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return ASSETLINKS_OUT


# ---------------------------------------------------------------- 빌드

def jdk_env() -> dict[str, str]:
    """Bubblewrap이 jarsigner·keytool을 이름만으로 부르므로, 받아 둔 JDK의 bin을 PATH 앞에 붙인다."""
    try:
        jdk = Path(json.loads(BUBBLEWRAP_CONFIG.read_text(encoding="utf-8")).get("jdkPath", ""))
    except (OSError, ValueError):
        return {}
    if not (jdk / "bin").exists():
        return {}
    return {"JAVA_HOME": str(jdk), "PATH": str(jdk / "bin") + os.pathsep + os.environ.get("PATH", "")}


def patch_bubblewrap(bubblewrap: str) -> None:
    """Node 18.20.2+/20.12.2+/22+는 .bat 직접 실행을 막아(spawn EINVAL) Bubblewrap 1.24.1의 gradlew·apksigner 호출이 실패한다.
    설치된 Bubblewrap의 execFile 호출을 Windows에서는 shell 경유로 바꾼다. 여러 번 실행해도 안전하다."""
    marker = "/* sharp-quest: windows shell patch v2 */"
    root = run([shutil.which("npm") or "npm", "root", "--global"], capture=True).stdout.strip()
    util = Path(root) / "@meta-quest" / "bubblewrap-cli" / "node_modules" / "@meta-quest" / "bubblewrap-core" / "dist" / "lib" / "util.js"
    if not util.exists():
        return
    source = util.read_text(encoding="utf-8")
    if marker in source:
        return
    old = "return await execFilePromise(cmd, args, { env: env, cwd: cwd });"
    # 이전 버전 패치가 있으면 원본으로 되돌린 뒤 다시 적용한다.
    source = re.sub(r"/\* sharp-quest: windows shell patch[^*]*\*/.*?" + re.escape(old), old, source, flags=re.S)
    # NoDefaultCurrentDirectoryInExePath 환경에서도 gradlew.bat를 찾도록 경로 없는 .bat에는 .\ 를 붙인다.
    new = (
        marker + r" if (process.platform === 'win32') { const q = (v) => /[\s&()^%!]/.test(v) ? '\"' + v + '\"' : v;"
        r" const c = (/\.(bat|cmd)$/i.test(cmd) && !/[\\/]/.test(cmd)) ? '.\\' + cmd : cmd;"
        r" return await execFilePromise(q(c), args.map(q), { env: env, cwd: cwd, shell: true }); }"
        r" return await execFilePromise(cmd, args, { env: env, cwd: cwd });"
    )
    if old not in source:
        say("[주의] Bubblewrap 내부 구조가 달라 Windows 패치를 적용하지 못했습니다. 빌드가 spawn EINVAL로 실패하면 알려 주세요.")
        return
    util.write_text(source.replace(old, new), encoding="utf-8")
    say("Bubblewrap에 Windows 호환 패치를 적용했습니다.")


def cmd_build(_: argparse.Namespace) -> None:
    if not shutil.which("node") or not shutil.which("npm"):
        fail("Node.js 18 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요.")

    bubblewrap = shutil.which("bubblewrap")
    if not bubblewrap:
        say(f"Bubblewrap({BUBBLEWRAP_PACKAGE})을 설치합니다...")
        if run([shutil.which("npm") or "npm", "install", "--global", BUBBLEWRAP_PACKAGE]).returncode != 0:
            fail("Bubblewrap 설치에 실패했습니다.")
        bubblewrap = shutil.which("bubblewrap")
        if not bubblewrap:
            fail("설치 후에도 bubblewrap 명령을 찾지 못했습니다. 새 터미널에서 다시 실행하세요.")

    patch_bubblewrap(bubblewrap)

    if not BUBBLEWRAP_CONFIG.exists() or not json.loads(BUBBLEWRAP_CONFIG.read_text(encoding="utf-8") or "{}").get("androidSdkPath"):
        say()
        say("처음 실행이라 Bubblewrap이 JDK와 Android SDK를 내려받습니다(약 1GB, 수 분).")
        say("질문이 나오면 Y(예)를 입력하고 약관에 동의하세요.")
        say()
        if run([bubblewrap, "doctor"]).returncode != 0:
            fail("JDK/Android SDK 준비에 실패했습니다.")

    password = ensure_password()
    ensure_keystore(password)

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(TWA_MANIFEST.read_text(encoding="utf-8"))
    manifest["signingKey"] = {"path": str(KEYSTORE), "alias": ALIAS}
    icon_base = os.environ.get("SHARP_TWA_ICON_BASE")  # 배포 전 시험 빌드용: 아이콘을 다른 주소에서 받는다.
    if os.environ.get("SHARP_TWA_MANIFEST_URL"):  # 배포 전 시험 빌드용: 웹 매니페스트를 다른 주소에서 받는다.
        manifest["webManifestUrl"] = os.environ["SHARP_TWA_MANIFEST_URL"]
    if icon_base:
        for key in ("iconUrl", "maskableIconUrl"):
            manifest[key] = icon_base.rstrip("/") + "/" + manifest[key].rsplit("/", 1)[-1]
    (BUILD_DIR / "twa-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    env = {**jdk_env(), "BUBBLEWRAP_KEYSTORE_PASSWORD": password, "BUBBLEWRAP_KEY_PASSWORD": password}
    say("Android 프로젝트를 만들고 APK를 빌드합니다...")
    if run([bubblewrap, "update", "--skipVersionUpgrade"], cwd=BUILD_DIR, env=env).returncode != 0:
        fail("프로젝트 생성에 실패했습니다. Pages 주소가 열리는지(아이콘 URL 포함) 확인하세요.")
    if run([bubblewrap, "build"], cwd=BUILD_DIR, env=env).returncode != 0:
        fail("APK 빌드에 실패했습니다. 위 로그를 확인하세요.")

    built = BUILD_DIR / "app-release-signed.apk"
    if not built.exists():
        fail("app-release-signed.apk를 찾지 못했습니다.")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(built, APK_OUT)

    fingerprint = sha256_fingerprint(password)
    links = write_assetlinks(fingerprint)
    say()
    say("[완료]")
    say(f"  APK: {APK_OUT}")
    say(f"  SHA-256 지문: {fingerprint}")
    say(f"  assetlinks.json: {links}")
    say("  주소 표시줄을 없애려면 위 지문을 담당자(에이전트)에게 알려 주세요.")
    say("  (https://shimanskim.github.io/.well-known/assetlinks.json 에 올려야 합니다)")
    say("  다음 단계: Quest를 USB로 연결하고 install_quest_app.bat 실행.")


def cmd_fingerprint(_: argparse.Namespace) -> None:
    fingerprint = sha256_fingerprint(ensure_password())
    say(fingerprint)
    say(f"assetlinks.json: {write_assetlinks(fingerprint)}")


# ---------------------------------------------------------------- 설치

def find_adb() -> Path | None:
    candidates = [shutil.which("adb"), KEY_DIR / "platform-tools" / "adb.exe"]
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if sdk:
        candidates.append(Path(sdk) / "platform-tools" / "adb.exe")
    if BUBBLEWRAP_CONFIG.exists():
        try:
            candidates.append(Path(json.loads(BUBBLEWRAP_CONFIG.read_text(encoding="utf-8")).get("androidSdkPath", "")) / "platform-tools" / "adb.exe")
        except (OSError, ValueError):
            pass
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    return None


def download_platform_tools() -> Path:
    say("adb(platform-tools)를 내려받습니다...")
    KEY_DIR.mkdir(parents=True, exist_ok=True)
    archive = KEY_DIR / "platform-tools.zip"
    urllib.request.urlretrieve(PLATFORM_TOOLS_URL, archive)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(KEY_DIR)
    archive.unlink(missing_ok=True)
    adb = KEY_DIR / "platform-tools" / "adb.exe"
    if not adb.exists():
        fail("adb 설치에 실패했습니다.")
    return adb


def cmd_install(args: argparse.Namespace) -> None:
    apk = Path(args.apk) if args.apk else APK_OUT
    if not apk.exists():
        fail(f"APK가 없습니다: {apk}\n먼저 build_quest_apk.bat를 실행하세요.")

    adb = find_adb() or download_platform_tools()
    run([str(adb), "start-server"], capture=True)
    result = run([str(adb), "devices"], capture=True)
    devices = [line.split() for line in result.stdout.splitlines()[1:] if line.strip()]
    ready = [d for d in devices if len(d) >= 2 and d[1] == "device"]
    if not ready:
        if any(len(d) >= 2 and d[1] == "unauthorized" for d in devices):
            fail("Quest 화면에서 'USB 디버깅 허용' 창이 떠 있는지 확인하고 [항상 허용]을 누른 뒤 다시 실행하세요.")
        fail("연결된 Quest가 없습니다. 개발자 모드를 켠 Quest를 USB로 PC에 연결하고, 헤드셋을 쓴 상태에서 다시 실행하세요.")
    if len(ready) > 1:
        fail("기기가 둘 이상 연결되어 있습니다. Quest 하나만 연결하세요.")

    say(f"설치 중: {apk.name}")
    result = run([str(adb), "install", "-r", str(apk)], capture=True)
    say(result.stdout.strip())
    if result.returncode != 0 or "Success" not in result.stdout:
        fail(f"설치하지 못했습니다.\n{result.stderr}")
    say()
    say("[설치 완료] Quest에서 앱 라이브러리 → 오른쪽 위 필터 → '알 수 없는 출처'에서 'SHARP 뷰어'를 실행하세요.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build").set_defaults(run=cmd_build)
    sub.add_parser("fingerprint").set_defaults(run=cmd_fingerprint)
    install = sub.add_parser("install")
    install.add_argument("--apk", help=f"설치할 APK 경로(기본: {APK_OUT})")
    install.set_defaults(run=cmd_install)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
