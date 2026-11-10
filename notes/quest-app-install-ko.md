# Quest 3 앱 설치·사용 안내

이 앱은 Quest 3에서 SHARP가 만든 PLY(Gaussian splat)와 VR 영상·사진을 IP 주소 입력 없이 보는 뷰어다.
주소는 `https://shimanskim.github.io/sharp-gaussian-splatting-vr-toolkit/`이다.
설치 방법은 두 가지다. 먼저 1번으로 써 보고, 앱 아이콘이 필요하면 2번을 한다.

| 방법 | 준비 | 아이콘 | 걸리는 시간 |
|---|---|---|---|
| 1. 브라우저에서 바로 열기 | 없음 | 없음(북마크) | 1분 |
| 2. 앱 아이콘 설치(APK) | 개발자 모드, USB 케이블, PC 작업 | 있음 | 처음 한 번 30분 안팎 |

## 1. 브라우저에서 바로 열기

1. Quest 3에서 브라우저를 연다.
2. 주소창에 `shimanskim.github.io/sharp-gaussian-splatting-vr-toolkit/`를 입력한다.
3. 별 모양 버튼을 눌러 북마크에 넣는다. 다음부터는 북마크로 연다.

처음 연 뒤에는 앱 파일이 Quest에 저장되므로 인터넷이 없어도 앱이 열린다.
앱 코드를 고치면 다음에 열 때 자동으로 새 버전으로 바뀐다. 다시 설치할 일이 없다.

## 2. 앱 아이콘 설치 (APK, 처음 한 번)

앱 아이콘은 Quest 앱 보관함의 「알 수 없는 출처」에 나타난다.
APK는 위 주소를 여는 껍데기라서 한 번만 설치하면 된다. 웹 코드가 바뀌어도 다시 설치하지 않는다.

### 사람이 직접 해야 하는 일

| 순서 | 할 일 | 어디서 |
|---|---|---|
| 1 | Meta 개발자 조직 만들기. 휴대폰 번호(SMS) 또는 결제 수단으로 계정을 인증한다. | https://developers.meta.com/horizon/manage |
| 2 | Quest 개발자 모드 켜기. | 휴대폰의 Meta Horizon 앱 → 기기 → 헤드셋 설정 → 개발자 모드 |
| 3 | PC에서 `build_quest_apk.bat` 실행. 질문이 나오면 `Y`를 입력한다. | PC |
| 4 | Quest를 USB로 PC에 연결하고, 헤드셋을 쓴 채로 「USB 디버깅 허용」을 누른다. | Quest, PC |
| 5 | PC에서 `install_quest_app.bat` 실행. | PC |
| 6 | 서명 키 백업. `%USERPROFILE%\.sharp-quest\` 폴더를 통째로 복사해 둔다. | PC |

### build_quest_apk.bat가 하는 일

1. Node.js가 있으면 Bubblewrap(Meta 공식 PWA 패키징 도구)을 설치한다.
2. 처음에는 JDK와 Android SDK를 내려받는다(약 1GB, 수 분). 약관 질문에 `Y`로 답한다.
3. 서명 키를 만들어 `%USERPROFILE%\.sharp-quest\`에 저장한다.
   키 파일은 `sharp-quest.keystore`, 비밀번호는 `keystore-password.txt`다.
4. APK를 `outputs\quest_app\sharp-quest-viewer.apk`에 만든다.
5. 화면에 SHA-256 지문을 보여 준다.

Node.js 18 이상이 없으면 https://nodejs.org 에서 먼저 설치한다.
서명 키를 잃어버리면 같은 앱을 업데이트할 수 없고 새 앱으로 다시 설치해야 한다.
키 폴더는 Git 저장소 밖에 있으므로 올라가지 않는다. 비밀번호 파일은 남에게 보내지 않는다.

### install_quest_app.bat가 하는 일

1. adb가 없으면 Google 공식 platform-tools를 내려받는다.
2. 연결된 Quest를 찾아 APK를 설치한다.

설치가 끝나면 Quest에서 앱 보관함을 연다.
오른쪽 위 필터를 「알 수 없는 출처」로 바꾸면 「SHARP 뷰어」가 보인다.

### 위쪽 주소 표시줄 없애기 (선택)

설치 직후에는 앱 위쪽에 주소 표시줄이 보일 수 있다.
앱이 이 주소의 주인이라는 증명 파일(`assetlinks.json`)을 `https://shimanskim.github.io/.well-known/assetlinks.json`에 올리면 사라진다.
`build_quest_apk.bat`가 끝날 때 보여 주는 SHA-256 지문을 담당자(에이전트)에게 알려 주면 올려 준다.
올리지 않아도 앱은 그대로 동작한다.

## 3. 사용법

### 기기에서 PLY 열기

1. 앱을 열고 [기기에서 파일 열기]를 누른다.
2. Quest 파일 선택 창에서 `.ply`를 고른다. 여러 개를 한 번에 고를 수 있다.
3. 고른 파일이 「이번에 연 파일」 목록에 쌓이고, 첫 PLY가 바로 열린다.
4. 목록에서 다른 파일을 누르면 전환된다.

Quest에 파일을 넣는 방법은 두 가지다.

- USB로 PC에 연결하고 `내부 공유 저장용량\Download` 폴더에 복사한다.
- PC 연결 모드에서 파일을 열고 [보관]을 누른다.

### 보관함

[보관]을 누르면 파일이 앱 안에 복사되어 앱을 껐다 켜도 「보관함」 탭에 남는다.
[삭제]를 누르면 앱 안의 복사본만 지워지고 원본은 그대로다.
설정을 열면 앱이 쓰는 저장 공간을 볼 수 있다.

### VR로 보기

1. 위쪽 [VR 보기] 버튼을 누른다.
2. VR 안에서 아래 조작을 쓴다.

| 조작 | 동작 |
|---|---|
| 왼쪽 스틱 | 이동 |
| 오른쪽 스틱 | 좌우 회전 |
| 그립 | 위(오른쪽)·아래(왼쪽) 이동 |
| 트리거 | 앞(오른쪽)·뒤(왼쪽) 이동(줌) |
| X / A | 이전 / 다음 파일 |
| B / Y | VR 패널 열기·닫기 |

VR 패널에서는 파일 목록, 이전·다음, 위치 초기화, VR 종료를 컨트롤러 레이와 트리거로 누른다.

### 화면이 깜빡이거나 느릴 때

설정의 「그래픽 품질」을 낮춘다.
Quest 3의 기본값은 「안전 5」다. 깜빡이면 3이나 1로 내리고, 선명도가 아쉬우면 7로 올린다.
품질을 바꾸면 앱이 다시 시작된다.

## 4. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `build_quest_apk.bat`에서 「Node.js 18 이상이 필요합니다」 | https://nodejs.org 에서 LTS 설치 후 다시 실행 |
| 빌드가 「프로젝트 생성에 실패했습니다」 | 브라우저에서 앱 주소가 열리는지, 아이콘 주소가 열리는지 확인 |
| `install_quest_app.bat`가 「연결된 Quest가 없습니다」 | USB 케이블을 바꾸고, 헤드셋을 쓴 상태에서 「USB 디버깅 허용」을 누른 뒤 다시 실행 |
| 「알 수 없는 출처」에 앱이 없음 | 설치 결과가 `Success`였는지 확인하고, 헤드셋을 다시 시작 |
| 앱 위쪽에 주소 표시줄이 보임 | 정상이다. 위 「주소 표시줄 없애기」를 하면 사라진다 |
| 앱 아이콘으로 연 뒤 [VR 보기]가 눌리지 않음 | 이 경우는 확인이 필요한 항목이다. 1번 방법(브라우저)으로 열면 VR이 되는지 확인하고 담당자에게 알려 준다 |
| PLY가 열리지 않음 | 파일이 SHARP가 만든 `.ply`인지 확인. 그래도 안 되면 설정에서 품질을 「안전 1」로 낮춤 |
| 앱이 옛 화면으로 열림 | 앱을 완전히 끄고 다시 연다. 두 번 열면 새 버전으로 바뀐다 |

## 5. 개발자용 메모

- 배포: `main` 또는 `quest-app` 브랜치에 `quest-app/` 변경이 push되면 `.github/workflows/pages.yml`이 빌드해 GitHub Pages에 올린다.
- 오프라인 캐시: `quest-app/public/sw.js`가 앱 파일 목록(`precache-manifest.js`, 빌드가 생성)을 설치 때 캐시한다.
  `npm run build`가 목록을 새로 만들고, 목록이 바뀌면 캐시 이름이 바뀌어 옛 캐시를 지운다.
- 아이콘: `python scripts/make_quest_app_icons.py`가 `quest-app/public/icons/`를 만든다.
- APK 설정: `twa/twa-manifest.json`(패키지 ID `io.github.shimanskim.sharpquest`, 2D 모드, Quest용 targetSdk 32는 Bubblewrap이 자동 적용).
- 서명 키 지문 다시 보기: `python scripts/quest_apk_tool.py fingerprint`.
