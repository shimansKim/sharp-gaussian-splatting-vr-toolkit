# Quest 3 앱 설치·사용 안내

> **폐기 결정:** 웹 앱·스토어 준비물은 폐기 결정됐으며 파일은 아직 남아 있다. 새 작업 대상이 아니다.
> Quest 네이티브 뷰어는 [Splatia](../quest-native/README.md)를 본다.

이 앱은 Quest 3에서 SHARP가 만든 PLY(Gaussian splat)와 VR 영상·사진을 IP 주소 입력 없이 보는 뷰어다.
주소는 `https://shimanskim.github.io/sharp-gaussian-splatting-vr-toolkit/`이다.
설치 방법은 두 가지다. 먼저 1번으로 써 보고, 앱 아이콘이 필요하면 2번을 한다.

| 방법 | 준비 | 아이콘 | 걸리는 시간 |
|---|---|---|---|
| 1. 브라우저에서 바로 열기 | 없음 | 없음(북마크) | 1분 |
| 2. 앱 아이콘 설치(APK) | 개발자 모드, USB 케이블 | 있음(2개: 「SHARP 뷰어」, 「SHARP VR」) | 처음 한 번 10분 안팎 |

**한 줄 요약: VR로 볼 때는 「SHARP VR」, 기기 파일을 가져올 때는 「SHARP 뷰어」를 쓴다.**

## 1. 브라우저에서 바로 열기

1. Quest 3에서 브라우저를 연다.
2. 주소창에 `shimanskim.github.io/sharp-gaussian-splatting-vr-toolkit/`를 입력한다.
3. 별 모양 버튼을 눌러 북마크에 넣는다. 다음부터는 북마크로 연다.

처음 연 뒤에는 앱 파일이 Quest에 저장되므로 인터넷이 없어도 앱이 열린다.
앱 코드를 고치면 다음에 열 때 자동으로 새 버전으로 바뀐다. 다시 설치할 일이 없다.

## 2. 앱 아이콘 설치 (APK, 처음 한 번)

앱 아이콘은 Quest 앱 보관함의 「알 수 없는 출처」에 나타난다.
APK는 위 주소를 여는 껍데기라서 한 번만 설치하면 된다. 웹 코드가 바뀌어도 다시 설치하지 않는다.
APK는 두 개다. 같은 서명 키로 만들고 서로 다른 앱으로 설치된다.

| 앱 | 용도 | 비고 |
|---|---|---|
| 「SHARP VR」 | VR로 보기. 아이콘을 누르면 바로 VR로 들어가 파일 패널(PC·드라이브·보관함)이 뜬다 | 몰입(immersive) 모드. 2D 화면이 없어 기기 파일 선택창은 못 쓴다 |
| 「SHARP 뷰어」 | 2D 화면. 기기 파일 가져오기, 보관함 관리, PC 연결 설정, 목록 정리 | 2D 모드. 이 앱 안에서는 VR로 들어갈 수 없다(Quest가 2D 모드 앱에 VR 세션을 주지 않는다). VR 버튼을 누르면 「SHARP VR」을 쓰라는 안내가 뜬다 |

두 앱은 같은 보관함을 쓴다(실기기에서 확인: 「SHARP 뷰어」에서 [보관]한 파일이 「SHARP VR」의 보관함 탭에도 보인다. 두 앱이 같은 웹 주소의 저장 공간을 나눠 쓰기 때문이다).

사람이 할 일은 아래 세 단계뿐이다.

### 사람이 직접 해야 하는 일

| 순서 | 할 일 | 어디서 |
|---|---|---|
| 1 | Meta 개발자 조직을 만들고 Quest 개발자 모드를 켠다. 조직은 휴대폰 번호(SMS) 또는 결제 수단으로 인증한다(1회). 개발자 모드는 휴대폰의 Meta Horizon 앱 → 기기 → 헤드셋 설정 → 개발자 모드. | https://developers.meta.com/horizon/manage, 휴대폰 |
| 2 | Quest를 USB로 PC에 연결하고, 헤드셋을 쓴 채로 「USB 디버깅 허용」을 누른다(「항상 허용」 체크). | Quest, PC |
| 3 | PC에서 `bat\install_quest_app.bat`를 실행한다. 「설치 완료」가 나오면 끝이다. | PC |

설치가 끝나면 Quest에서 앱 보관함을 연다.
오른쪽 위 필터를 「알 수 없는 출처」로 바꾸면 「SHARP 뷰어」(2D, 파일·목록)와 「SHARP VR」(VR 보기) 두 개가 보인다.
두 앱을 모두 설치하려면 `bat\install_quest_app.bat` 한 번이면 된다(이미 설치된 앱은 지우지 않고 덮어쓴다. 보관함 데이터는 그대로 남는다).

### 이미 만들어 둔 것

| 항목 | 위치 |
|---|---|
| 설치용 APK | `outputs\quest_app\sharp-quest-viewer.apk`(「SHARP 뷰어」, 2D)와 `outputs\quest_app\sharp-quest-vr.apk`(「SHARP VR」). 저장소 폴더 안이며 Git에는 올라가지 않는다 |
| 서명 키 | `%USERPROFILE%\.sharp-quest\sharp-quest.keystore` |
| 서명 키 비밀번호 | `%USERPROFILE%\.sharp-quest\keystore-password.txt` (메모장으로 열면 한 줄이 보인다) |
| 주소 표시줄 제거·몰입 앱 실행용 증명 파일 | https://shimanskim.github.io/.well-known/assetlinks.json (두 패키지 `io.github.shimanskim.sharpquest`, `io.github.shimanskim.sharpquest.vr`가 같은 지문으로 올라가 있다) |

`%USERPROFILE%\.sharp-quest\` 폴더를 통째로 복사해 안전한 곳(외장 드라이브 등)에 백업해 둔다.
서명 키를 잃어버리면 같은 앱을 업데이트할 수 없고 새 앱으로 다시 설치해야 한다.
이 폴더는 Git 저장소 밖에 있으므로 GitHub에 올라가지 않는다. 비밀번호 파일은 남에게 보내지 않는다.

### APK를 다시 만들고 싶을 때 (보통은 필요 없다)

앱 이름·아이콘·주소 같은 APK 자체 설정을 바꿨을 때만 `bat\build_quest_apk.bat`를 실행한다. 두 APK를 모두 다시 만든다(하나만: `python scripts\quest_apk_tool.py build --variant vr` 또는 `--variant 2d`).

1. Node.js 18 이상이 필요하다. 없으면 https://nodejs.org 에서 LTS를 설치한다.
2. `bat\build_quest_apk.bat`를 실행한다. 처음에는 JDK와 Android SDK를 내려받는다(약 1GB, 수 분).
   질문이 나오면 `Y`를 입력하고 약관에 동의한다.
3. 서명 키가 이미 있으면 그대로 쓴다. 같은 키로 만들었으므로 SHA-256 지문도 같다.
4. 끝나면 APK 경로와 지문이 화면에 나온다. 위 「설치용 APK」 위치에 새로 만들어진다.
5. 「SHARP VR」은 증명 파일에 패키지가 올라가 있어야 실행된다(검증에 실패하면 Quest가 몰입 앱을 열지 않는다). 서명 키가 같으면 이미 올라가 있어 할 일이 없다.

### 주소 표시줄

앱이 이 주소의 주인이라는 증명 파일(`assetlinks.json`)이 올라가 있어서, 앱 위쪽에 주소 표시줄이 보이지 않는다.
「SHARP VR」은 이 증명이 없으면 아예 실행되지 않는다.
증명 파일의 SHA-256 지문은 `F0:49:50:95:A1:C4:13:94:78:2D:E2:2E:6C:75:44:C6:67:B5:76:09:B4:AF:33:FC:13:34:FE:F2:48:3E:22:1B`이다.
서명 키를 새로 만들면 지문이 달라지므로 증명 파일도 다시 올려야 한다.
설치 직후 표시줄이 보이면 앱을 완전히 끄고 다시 연다. 처음 한 번은 Quest가 증명을 확인하느라 늦을 수 있다.

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

1. 「SHARP VR」 아이콘을 누른다. 바로 VR로 들어가고 파일 패널이 열린다. 위쪽 줄에서 PC·드라이브·보관함을 고르고 파일을 누른다.
   (Quest 브라우저 탭에서 앱 주소를 열고 위쪽 [VR 보기]를 눌러도 된다. 「SHARP 뷰어」 앱 안에서는 VR이 열리지 않는다.)
2. VR 안에서 아래 조작을 쓴다.

PLY를 열거나 VR에 들어가면 장면이 눈앞 적당한 크기로 자동으로 맞춰진다. 처음 몇 초 동안 조작 안내 카드가 뜨고, 이후에는 왼손을 눈앞으로 들면 손 위에 나타난다.

| 조작 | 동작 |
|---|---|
| 그립(옆 버튼) 한 손 | 장면을 잡고 끌어 이동, 손을 좌우로 돌리면 같이 회전 |
| 양손 그립 | 두 손을 벌리면 확대, 모으면 축소(두 손 사이 가운데 기준), 두 손을 잇는 선을 돌리면 회전 |
| 왼쪽 스틱 | 부드러운 이동 |
| 오른쪽 스틱 좌우 | 30°씩 돌리기. 스틱을 민 쪽으로 장면이 돈다 |
| 오른쪽 스틱 위아래 | 높이. 위로 밀면 장면이 위로 간다 |
| 오른쪽 스틱 누르기 | 크기·위치 맞춤. 맞춘 상태에서 한 번 더 누르면 원본 카메라 자리에서 1:1로 보기 |
| 왼쪽 스틱 누르기 | 크기만 맞춤 크기로 되돌리기(위치·방향은 그대로) |
| X / A | 이전 / 다음 파일 |
| B / Y | 짧게: 모든 UI 켜기·끄기 / 길게: UI를 지금 보는 곳으로 옮기기 |

VR 패널은 PLY에서는 장면 바깥쪽(시선이 장면에서 벗어났어도 장면과 겹치지 않는 쪽)에 열리고, 열 때 한 번만 자리를 잡아 이후에는 움직이지 않는다.

**PLY 옵션**(패널 아래쪽 [PLY 옵션] 버튼, 누르면 [파일 목록]으로 돌아옴. 값은 저장된다):

| 옵션 | 설명 |
|---|---|
| 화질 | 안전 1/3/5/7/10. 높을수록 선명하고 무겁다 |
| 전체 보기 | 큰 점·가장자리 점이 잘리거나 버려지는 설정(최대 점 크기, 화면 밖 점 제외, 투명도 기준, 시야 밖 밀도 감소, Quest 가장자리 해상도 감소)을 풀어 가장자리를 최대한 살린다. 켜면 느려지거나 깜빡일 수 있어 끄는 쪽이 기본이다 |
| 점 크기 | ×0.7~×1.5. 점이 성기게 보이면 키운다 |
| 자세 유지 | 켬(기본): X/A로 이전·다음 PLY로 가도 시점·위치·크기를 그대로 둔다. 같은 영상에서 뽑은 PLY를 이어 볼 때 좋다. 끄면 매번 눈앞에 새로 맞춘다 |
| 미리 받기 | 다음 PLY를 미리 읽어 둬 전환이 빨라진다(120MB 이하 한 장만) |

참고: SHARP PLY는 원래 사진이 찍힌 화면 범위만 복원하므로 가장자리가 들쭉날쭉하거나 그 바깥이 비는 것은 파일 자체의 한계일 수 있다. 장면 전체를 한눈에 보려면 오른쪽 스틱 누르기(크기·위치 맞춤)를 쓴다. 파일 목록, 이전·다음, 위치 초기화(=크기·위치 맞춤), 크기 초기화, 1:1 몰입, 조작 안내, VR 종료를 컨트롤러 레이와 트리거로 누른다.

### 화면이 깜빡이거나 느릴 때

설정의 「그래픽 품질」을 낮춘다.
Quest 3의 기본값은 「안전 5」다. 깜빡이면 3이나 1로 내리고, 선명도가 아쉬우면 7로 올린다.
품질을 바꾸면 앱이 다시 시작된다.

## 4. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `bat\build_quest_apk.bat`에서 「Node.js 18 이상이 필요합니다」 | https://nodejs.org 에서 LTS 설치 후 다시 실행 |
| 빌드가 「프로젝트 생성에 실패했습니다」 | 브라우저에서 앱 주소와 `manifest.webmanifest`, 아이콘 주소가 열리는지 확인 |
| 휴대폰 Horizon 앱에 개발자 모드 스위치가 안 보임 | Meta 개발자 조직이 만들어졌고 인증(SMS 또는 결제 수단)이 끝났는지 확인한 뒤 Horizon 앱을 완전히 끄고 다시 연다 |
| `bat\install_quest_app.bat`가 「연결된 Quest가 없습니다」 | USB 케이블을 바꾸고, 헤드셋을 쓴 상태에서 「USB 디버깅 허용」을 누른 뒤 다시 실행 |
| 「알 수 없는 출처」에 앱이 없음 | 설치 결과가 `Success`였는지 확인하고, 헤드셋을 다시 시작 |
| 앱 위쪽에 주소 표시줄이 보임 | 앱을 완전히 끄고 다시 연다. 계속 보이면 https://shimanskim.github.io/.well-known/assetlinks.json 이 열리는지 확인하고 담당자에게 알린다. 앱 사용에는 지장이 없다 |
| 「SHARP 뷰어」(2D)에서 [VR 보기]가 안 되거나 「VR 시도(지원 확인 안 됨)」로 보임 | 정상이다. Quest가 2D 모드 앱에는 VR 세션을 주지 않는다. VR은 「SHARP VR」 앱(또는 브라우저 탭)에서 본다 |
| 「SHARP VR」이 열리지 않거나 바로 꺼짐 | assetlinks.json에 `io.github.shimanskim.sharpquest.vr`가 같은 지문으로 올라가 있는지 확인(https://shimanskim.github.io/.well-known/assetlinks.json). 그다음 설치 결과가 `Success`였는지 확인하고 헤드셋을 다시 시작 |
| 「SHARP VR」에서 파일이 안 보임 | 위쪽 줄에서 PC·드라이브·보관함을 바꿔 본다. 「이번에 연 파일」(기기 파일)은 VR에서 쓸 수 없다. 기기 파일은 「SHARP 뷰어」에서 [보관]해 두면 보관함에서 연다 |
| 영상이 재생되지 않거나 자주 끊기고 앱에 「Quest 한계(4K)를 넘어…」 경고가 뜸 | H.264 8K 영상입니다. PC에서 `bat\make_quest_app_video.bat`에 영상을 끌어다 놓거나 대시보드의 「Quest 앱용 HEVC 변환」으로 HEVC로 바꾼 뒤 다시 열기. 기존 `quest3_8k` 최적화는 PC 스트리밍 플레이어(4XVR 등)용이라 앱에는 맞지 않음. 자세한 안내는 README의 「웹 앱용 영상 만들기 (HEVC 변환)」 |
| PLY가 열리지 않음 | 파일이 SHARP가 만든 `.ply`인지 확인. 그래도 안 되면 설정에서 품질을 「안전 1」로 낮춤 |
| PLY를 열 때 「failed to fetch dynamically imported module」 | 새 버전이 배포된 뒤 옛 화면이 남은 경우다. 이제는 자동으로 한 번 다시 시작한다. 계속되면 앱을 완전히 끄고 다시 연다 |
| 앱이 옛 화면으로 열림 | 앱을 완전히 끄고 다시 연다. 두 번 열면 새 버전으로 바뀐다 |

## 5. 개발자용 메모

- 배포: `main` 또는 `quest-app` 브랜치에 `quest-app/` 변경이 push되면 `.github/workflows/pages.yml`이 빌드해 GitHub Pages에 올린다.
- 오프라인 캐시: `quest-app/public/sw.js`가 앱 파일 목록(`precache-manifest.js`, 빌드가 생성)을 설치 때 캐시한다.
  `npm run build`가 목록을 새로 만들고, 목록이 바뀌면 캐시 이름이 바뀌어 옛 캐시를 지운다.
- 아이콘: `python scripts/make_quest_app_icons.py`가 `quest-app/public/icons/`를 만든다.
- APK 설정: `twa/twa-manifest.json`(2D 모드, 패키지 `io.github.shimanskim.sharpquest`, 「SHARP 뷰어」)와 `twa/twa-manifest.vr.json`(몰입 모드, 패키지 `io.github.shimanskim.sharpquest.vr`, 「SHARP VR」, 시작 주소 `?vr=1`). Quest용 targetSdk 32는 Bubblewrap이 자동 적용. 빌드 폴더·APK 파일·assetlinks 항목이 변형별로 나뉜다(`scripts/quest_apk_tool.py`의 `VARIANTS`).
- `?vr=1`: 주소에 붙으면 앱이 스스로 VR에 들어가고(`core/vr-launch.js`) 마지막에 쓴 소스(PC 기본)의 목록 패널을 띄운다. 소스 선택은 VR 패널 맨 위 줄에 있다.
- 서명 키 지문 다시 보기: `python scripts/quest_apk_tool.py fingerprint`.
- APK 빌드 도구가 하는 호환 처리: Meta Bubblewrap 1.24.1은 최신 Node에서 `gradlew.bat` 실행이 `spawn EINVAL`로 실패하므로, 설치 직후 `execFile` 한 줄에 Windows 셸 패치를 적용한다(여러 번 실행해도 안전). 받아 둔 JDK의 `bin`은 빌드할 때만 PATH에 붙인다.
- 배포 전 시험 빌드: 환경 변수 `SHARP_TWA_MANIFEST_URL`·`SHARP_TWA_ICON_BASE`로 웹 매니페스트·아이콘을 다른 주소에서 받을 수 있다. 쓰지 않으면 Pages 주소를 쓴다.
