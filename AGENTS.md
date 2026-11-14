# 저장소 작업 규칙

## 프로젝트 구성

- `run_tool_dashboard.bat`와 `scripts/`, `bat/`는 PC VR 데이터 생성 툴이다. `quest-native/`는 별개 프로젝트인 Quest 3 네이티브 뷰어 Splatia다.
- `run_quest_pc_server.bat`, `scripts/quest_media_server.py`, `pc-server/`는 뷰어에 PC 폴더를 읽기 전용으로 제공한다.
- `quest-app/`, `store-site/`, `twa/`, `webxr-spark-demo/`는 폐기 결정됐다. 파일과 웹 배포 워크플로는 아직 남아 있으나 새 작업 대상이 아니다.

## 작업 위치와 Git

- 주 체크아웃 `I:\06_SHARP_GaussianSplatting`은 수정·checkout·pull하지 않는다. 사람의 미커밋 변경과 충돌하거나 작업물을 덮어쓸 수 있다.
- `origin/main`에서 별도 worktree와 브랜치로 작업하고 소유 계정 토큰은 임시로만 쓴다. PR에는 로컬 변경과 충돌할 수 있는 파일을 밝힌다. 절차는 `sharp-worktree-pr`을 따른다.

## 파일과 실행 환경

- 기존 인코딩·줄 끝을 보존하고 새 파일은 UTF-8 BOM 없이 같은 종류의 줄 끝을 쓴다. 편집·검사는 `sharp-worktree-pr`을 따른다.
- Windows Python의 파이프 출력은 UTF-8로 설정한다. 기본 인코딩에서는 한글 출력이 실패할 수 있다.
- 배치 파일은 `cmd /c "<절대경로>"`로 호출한다. 일부 환경에서는 현재 폴더의 이름만으로 찾지 못한다.
- Android 패키지 세그먼트에 `native` 같은 Java 예약어를 쓰지 않는다. Gradle 빌드가 실패한다.
- 이 PC의 Android Studio JBR 후보는 `C:\Program Files\Android\Android Studio1\jbr`이다. 기본 설치 경로에 없을 수 있다.

## 공유 위치와 배포

- 공유 위치의 파일은 자신이 만들었고 다른 사람이 사용하지 않는다고 확실할 때만 삭제한다. 불확실하면 사령관에게 먼저 묻는다.
- 사용자 사이트를 직접 고치지 않는다. 웹 앱과 스토어 배포물은 폐기 결정됐으며 해당 파일과 워크플로는 아직 남아 있다.

## 기기와 라이선스

- 플랫폼 의존 기능은 설계 전에 최소 프로브를 실기기에서 검증한다. Quest 하드웨어 디코더와 OpenXR·Vulkan 확장도 명세와 실제 기기를 대조한다.
- 실기기 이상을 접수하면 수정 전에 2D/VR 모드, 문제 대상, FPS·로그 등 재현 수치를 확인한다. 같은 증상도 대상과 환경이 다를 수 있다.
- 외부 라이브러리나 바이너리를 추가하면 실제 의존성과 라이선스·저작권 고지를 대조하고 기존 검사를 유지한다. 간접 의존성의 고지도 빠질 수 있다.

## 모델 배정

- 모델 배정은 사용자 전역 규칙의 '전역 모델 분배 규칙'을 따른다. 작업 중 모델을 바꾸면 문맥을 다시 넘겨야 한다.

## 빌드와 검증

- PC 도구(`scripts/`, `bat/`, 대시보드)를 고치면 `python -m unittest discover tests -v`를 돌리고 `tool_dashboard_server.py`의 `TOOLS`·`ALLOWED_MODES`, `sharp_pipeline.py`의 `choices`, `bat/*.bat`의 상대 경로를 함께 맞춘다.
- PC 미디어 서버를 고치면 `python -m unittest tests.test_quest_media_server tests.test_sharp_pc_server`를 돌린다.
- Splatia 빌드·시험은 `sharp-quest-native-verify`와 `quest-native/README.md`를 따른다.
- Splatia 모듈 경계·공용 파일 변경은 `quest-native/docs/module-contract.md`를 따른다. 빌드별 출력은 `QN_BUILD_ROOT`로 분리하고 버전은 `quest-native/version.properties`에서 관리한다. 빌드의 `qnCheckLicenses` 검사를 유지한다.
- Windows PowerShell 5.1의 BOM 없는 스크립트와 한글 BAT 제어 흐름은 인코딩에 주의한다. 기존 UTF-8 로더와 도우미 BAT 방식을 따른다.

## 스킬

- `sharp-worktree-pr`: worktree 작업, 줄 끝 보존, 소유 계정 토큰 push와 PR 생성 때 쓴다.
- `sharp-quest-native-verify`: Splatia 빌드·무기기 시험·설치·로그 수집과 서드파티 추가 시 라이선스 고지 및 `qnCheckLicenses` 확인에 쓴다.
- 스킬 원본은 `.agents/skills/`, 사본은 `.claude/skills/`에 둔다. 고칠 때 두 곳을 같게 유지한다.

## 더 읽을 곳

- `README.md`: PC 툴과 저장소 구성.
- `quest-native/README.md`, `quest-native/docs/module-contract.md`: Splatia 사용·개발.
- `quest-native/docs/pc-source.md`: 공용 PC 서버 연결.
- `quest-native/docs/decoder-diagnostics.md`: 디코더 진단.
- `quest-native/docs/encoding-guide.md`: Quest 3 영상 인코딩.
- `notes/`: 폐기 결정된 웹 앱과 스토어의 참고 문서.
