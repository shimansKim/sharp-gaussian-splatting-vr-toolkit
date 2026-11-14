# 저장소 작업 규칙

## 작업 위치와 Git

- 주 체크아웃 `I:\06_SHARP_GaussianSplatting`은 수정·checkout·pull하지 않는다. 사람의 미커밋 변경과 충돌하거나 작업물을 덮어쓸 수 있다.
- `origin/main`을 fetch한 뒤 별도 worktree와 브랜치에서 작업한다. PR에는 사람의 로컬 변경과 충돌할 수 있는 파일을 밝힌다.
- 비대화형 push는 인증 관리자가 대기할 수 있으므로 소유 계정 토큰을 임시로만 쓴다. 토큰을 출력하거나 파일·remote 설정에 저장하지 않는다.
  `git -c credential.helper= push https://x-access-token:<토큰>@github.com/shimanskim/sharp-gaussian-splatting-vr-toolkit.git <브랜치>`
  `GH_TOKEN=$(gh auth token -u shimansKim) gh pr create`

## 파일과 실행 환경

- 기존 파일의 인코딩과 줄 끝을 보존하고 새 파일은 UTF-8 BOM 없이 같은 종류의 줄 끝을 따른다. 줄 끝 변환은 diff 전체를 오염시킨다.
- Git Bash `sed -i`는 CRLF를 바꾸므로 쓰지 않는다. 커밋 전에 diff와 줄 끝을 확인한다.
- Windows Python의 파이프 출력은 UTF-8로 설정한다. 기본 인코딩에서는 한글 출력이 실패할 수 있다.
- 배치 파일은 `cmd /c "<절대경로>"`로 호출한다. 일부 환경에서는 현재 폴더의 이름만으로 찾지 못한다.
- Android 패키지 세그먼트에 `native` 같은 Java 예약어를 쓰지 않는다. Gradle 빌드가 실패한다.
- 이 PC의 Android Studio JBR 후보는 `C:\Program Files\Android\Android Studio1\jbr`이다. 기본 설치 경로에 없을 수 있다.

## 공유 위치와 배포

- 공유 위치의 파일은 자신이 만들었고 다른 사람이 사용하지 않는다고 확실할 때만 삭제한다. 불확실하면 사령관에게 먼저 묻는다.
- 사용자 사이트 `shimansKim/shimansKim.github.io`를 직접 고치지 않는다. 다음 배포가 덮어쓰므로 이 저장소의 `quest-app/`, `store-site/`와 배포 워크플로 `.github/workflows/store-deploy.yml`을 고친다.

## 기기와 라이선스

- 플랫폼 의존 기능은 설계 전에 최소 프로브를 실기기에서 검증하고, 에뮬레이터가 다루지 않는 WebXR 경로는 명세와 구현도 대조한다. 2D TWA의 VR 제약과 레이어 크기 오류는 뒤늦게 발견됐다.
- 실기기 이상을 접수하면 수정 전에 2D/VR 모드, 문제 대상, FPS·로그 등 재현 수치를 확인한다. 같은 증상도 대상과 환경이 다를 수 있다.
- 외부 라이브러리나 바이너리를 추가하면 실제 의존성과 라이선스·저작권 고지를 대조하고 기존 검사를 유지한다. 간접 의존성의 고지도 빠질 수 있다.

## 모델 배정

- 모델 배정은 사용자 전역 규칙의 '전역 모델 분배 규칙'을 따른다. 작업 중 모델을 바꾸면 문맥을 다시 넘겨야 한다.

## 더 읽을 곳

- `notes/quest-app-design.md`: 앱 설계, 플랫폼 제약과 네트워크 탐색.
- `notes/quest-pc-connect-ko.md`: PC 연결과 서버 업데이트.
- `notes/store-deploy-ko.md`: 사용자 사이트 배포와 원본 위치.
- `notes/quest-app-install-ko.md`: Quest 앱 설치.
- `notes/quest-app-controls-ko.md`: 앱 조작법.
- `notes/quest-gdrive-setup-ko.md`: Google Drive 설정.
