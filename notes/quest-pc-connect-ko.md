# PC 서버 안내

설치형 앱 연결 방법은 [PC 연결 안내](../quest-native/docs/pc-source.md)를 참고한다.

## 기본: 설치형 PC 앱

PC 서버는 트레이 아이콘과 관리 창이 있는 Windows 앱(`Splatia PC Server`)으로 배포한다.
`Splatia-PC-Server-<버전>-Setup.exe`를 실행하면 관리자 권한 없이 내 계정에만 설치된다.
설치 없이 쓰려면 같은 릴리스의 zip을 풀어 `Splatia PC Server.exe`를 실행한다.

- 트레이 아이콘을 두 번 누르면 관리 창이 열린다. 공유 폴더, 포트, Windows 시작 시 자동 실행을 여기서 바꾼다.
- 공유 폴더는 읽기 전용이다. 처음에는 `문서\SHARP VR`을 공유한다.
- 설정은 `%LOCALAPPDATA%\SHARP PC Server`에 저장된다. 업그레이드해도 유지된다.
- 제거는 Windows 설정 → 앱 → 설치된 앱에서 한다. 제거할 때 설정을 지울지 묻는다.
- PC 브라우저의 `http://localhost:8787/settings/bindings`에서 버튼을 지정할 수 있다.
- 신뢰하는 네트워크에서만 실행한다.

설치 파일은 `python pc-server/build.py --installer`로 만든다(Inno Setup 6 필요). 자세한 내용은 `pc-server/README.txt`를 본다.

## 개발용: bat

저장소에서 직접 개발하거나 시험할 때만 `run_quest_pc_server.bat`를 쓴다.
검은 창에서 서버만 실행하며 트레이와 관리 창은 없다.
서버 파일을 갱신하려면 `update_quest_pc_server.bat`를 실행한다.
