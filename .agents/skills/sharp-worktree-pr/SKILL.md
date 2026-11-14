---
name: sharp-worktree-pr
description: SHARP 저장소에서 코드나 문서를 수정하고 worktree에서 커밋, 소유 계정 푸시, PR 생성까지 진행할 때 사용한다. "PR 올려줘", "푸시해줘", "worktree 만들어서" 같은 요청과 줄 끝 보존이 필요한 파일 수정에도 사용한다.
---

# SHARP worktree와 PR

기준 경로는 `I:\06_SHARP_GaussianSplatting`이다.
다른 PC에서는 실제 주 체크아웃 경로를 `<main>`으로 지정한다.
새 worktree는 보통 주 체크아웃 옆 `06_SHARP_GaussianSplatting-wt` 아래에 만들며, 사람이 지정한 위치가 있으면 따른다.

## 순서

1. 주 체크아웃은 수정하거나 checkout, pull하지 않는다.
   `git -C "<main>" fetch origin main`과 `git -C "<main>" worktree list`로 최신 기준과 기존 브랜치를 확인한다.
2. `git -C "<main>" worktree add "<worktree>" -b <branch> origin/main`으로 별도 worktree를 만든다.
   이후 명령은 worktree에서 실행한다.
3. 편집 전 대상 파일의 줄 끝을 확인한다.
   `python -c "d=open(r'<file>','rb').read();print('CRLF',d.count(b'\r\n'),'LF',d.count(b'\n')-d.count(b'\r\n'))"`을 쓸 수 있다.
   UTF-8 BOM 없이 기존 파일의 줄 끝을 보존하고, 새 파일은 같은 폴더의 관례를 따른다.
   저장소에는 LF와 CRLF가 섞여 있으므로 일괄 변환하지 않는다.
   Edit 또는 `open(path, encoding='utf-8', newline='')`를 쓰고 Git Bash의 `sed -i`는 쓰지 않는다.
4. 변경 범위에 맞게 시험한다.
   PC 도구는 `python -m unittest discover tests -v`, Quest는 `sharp-quest-native-verify` 절차를 따른다.
   한글 출력이 깨지면 `PYTHONUTF8=1`을 설정한다.
5. `git diff --stat`과 실제 diff를 확인하고 의도한 파일만 스테이징한다.
   커밋은 요청받았거나 작업에 승인된 경우에만 만든다.
   커밋 후 `python scripts/check_line_endings.py origin/main HEAD`를 실행한다.
   실패하면 의도하지 않은 줄 끝 변경을 고치고 다시 확인한다.
6. 푸시와 PR 생성도 별도 승인이 있을 때만 한다.
   기본 GitHub 계정에 쓰기 권한이 없을 수 있으므로 승인된 경우 소유 계정 토큰을 일회성으로 사용한다.
   토큰을 출력하거나 원격 설정에 저장하지 않는다.

```bash
TOKEN=$(gh auth token -u shimansKim) || exit 1
git -c credential.helper= push "https://x-access-token:${TOKEN}@github.com/shimansKim/sharp-gaussian-splatting-vr-toolkit.git" <branch> 2>&1 | sed 's/x-access-token:[^@]*@/x-access-token:***@/'
result=${PIPESTATUS[0]}
unset TOKEN
[ "$result" -eq 0 ] || exit "$result"
GH_TOKEN=$(gh auth token -u shimansKim) gh pr create --repo shimansKim/sharp-gaussian-splatting-vr-toolkit --base main --head <branch> --title "<title>" --body "<body>"
```

토큰을 원격 URL에 저장하는 `git remote set-url`은 쓰지 않는다.
위 `sed`는 출력만 가리며 파일을 편집하지 않는다.
PR에는 시험 결과와 사람의 로컬 변경에 충돌할 수 있는 파일을 적는다.
없으면 없다고 적고, 시스템이 요구하는 커밋·PR attribution도 따른다.
PR checks 상태를 확인하고 worktree 경로, 브랜치, PR 주소를 보고한다.
worktree 정리는 사람이 결정한다.

## 주의

한글이 많은 UTF-8 bat에서 `call :label`과 `goto`가 잘못 동작한 사례가 있다.
새 bat의 제어 흐름은 ASCII 보조 bat로 분리한다.
권한이나 샌드박스에 막히면 우회하지 말고 보고한다.
