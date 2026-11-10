"""대시보드가 새 콘솔 창에서 파이프라인을 실행할 때 쓰는 작은 실행기.

사용: python run_and_pause.py <스크립트> [인자 ...]

현재 파이썬(venv)으로 스크립트를 셸 없이 인자 목록 그대로 실행하고, 끝나면 창이 바로 닫히지 않게 pause 한다.
예전에는 `cmd.exe /c "<명령> & pause"` 문자열을 이어 붙였는데, 값에 `&` 같은 문자가 있으면 명령이 끼어들 수 있었다.
"""
from __future__ import annotations

import os
import subprocess
import sys


def pause() -> None:
    if os.name == "nt":
        os.system("pause")  # 고정 문자열이다. 외부 입력은 들어가지 않는다.
    else:
        try:
            input("[Enter를 누르면 창이 닫힙니다]...")
        except EOFError:
            pass


def main(argv: list[str]) -> int:
    if not argv:
        print("사용: python run_and_pause.py <스크립트> [인자 ...]")
        pause()
        return 2
    try:
        returncode = subprocess.run([sys.executable, *argv], check=False).returncode
    except OSError as error:
        print(f"실행하지 못했습니다: {error}")
        returncode = 1
    pause()
    return returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
