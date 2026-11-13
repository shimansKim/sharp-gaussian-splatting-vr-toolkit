# APK 서명·버전·축소(R8) 규칙

사이드로드(USB 설치)용 APK를 만드는 규칙과 그렇게 정한 이유를 적는다.
스토어 출시 때는 이 문서를 다시 본다.

## 1. 서명: PC마다 만드는 사이드로드 키

**결정**: 저장소에 키를 넣지 않는다.
`build.bat`이 처음 빌드할 때 이 PC의 서명 키를 저장소 밖에 만든다.

- 위치: `%USERPROFILE%\.sharp-quest-native\release.keystore`, `signing.properties`(비밀번호 포함)
  - `tools/qn_signing.bat`이 `keytool`로 만든다: RSA 2048, 유효 10000일, 별칭 `sharpquest`, 무작위 비밀번호.
  - `app/build.gradle`이 `signing.properties`를 읽어 release를 이 키로 서명한다.
  - 다른 위치를 쓰려면 환경 변수 `QN_SIGNING_PROPERTIES`에 그 파일 경로를 넣는다.
  - 이 파일이 없으면(예: `gradlew`를 직접 부를 때) release를 디버그 키로 서명한다.
- 이유
  - 저장소는 공개될 수 있다. 개인 키를 저장소에 넣으면 누구나 같은 서명으로 "업데이트"를 만들어, 이미 깔린 앱을 바꿔치기할 수 있다.
  - 사람은 보통 한 PC에서 빌드한다. PC마다 키가 달라도 불편이 작다.
- 대가: **다른 PC에서 만든 APK로 바꾸면 서명이 달라서 기존 앱을 지워야 한다.**
  - 앱을 지우면 앱 안의 설정·최근 목록·보관함·버튼 배정이 사라진다. 헤드셋에 넣어 둔 파일은 남는다.
  - `install.bat`이 이 경우("서명이 다름")를 알아보고 지울지 묻는다.
  - 여러 PC에서 같은 키를 쓰려면 `.sharp-quest-native` 폴더를 다른 PC의 같은 위치로 복사한다(비밀 파일이니 안전하게 옮긴다).
- 키를 잃어버리면 새 키가 만들어진다. 그다음 설치 때 기존 앱을 한 번 지워야 한다.
- 스토어 출시 때는 스토어용 업로드 키를 따로 만들고, 이 규칙을 다시 정한다.

## 2. 버전

- `quest-native/version.properties`의 `versionName`(MAJOR.MINOR.PATCH) 하나만 고친다.
- `versionCode = MAJOR × 1,000,000 + MINOR × 1,000 + PATCH`. `app/build.gradle`이 계산한다.
  - 예: 0.2.0 → 2000, 0.2.1 → 2001, 1.0.0 → 1000000
- 규칙
  - 사람에게 건넬 APK를 만들 때마다 PATCH 이상을 올린다.
  - 기능이 늘면 MINOR, 첫 정식판은 1.0.0으로 한다.
  - 버전을 내리면 `install.bat`이 "더 새 판이 있음"을 알리고, 그래도 설치할지 묻는다.
- 지금 값: 0.2.0(2000). 이전 시험판은 versionCode 1이었다.

## 3. 축소(R8, minify): 지금은 끔

**결정**: `minifyEnabled false`를 유지한다.
켤 때 쓸 keep 규칙은 `app/proguard-rules.pro`에 준비해 두었다.

- 끈 이유
  - 네이티브 코드가 Java를 이름으로 부른다(JNI).
    - `FindAppClass("com.sharp.questnative.ui.UiBridge")`, `GetStaticMethodID(…, "attachSurface", …)`
    - video의 `VideoPlayer`, `DiagRunner` 등
  - `core.ModuleLoader`가 `Class.forName("com.sharp.questnative.<id>.Module")`로 모듈을 찾는다.
  - R8이 이 이름을 지우거나 바꾸면 빌드와 JVM 단위 시험은 통과하지만, **헤드셋에서 실행할 때 처음 그 길을 지나는 순간 앱이 멈춘다.**
    실기기 확인 전에는 이 위험을 잡을 수단이 없다.
  - 얻는 것이 작다. APK가 약 11MB이고, 사이드로드에는 크기 제한이 없다.
- 켜는 순서(실기기 확인 뒤)
  1. `app/build.gradle`의 `minifyEnabled true`
  2. `proguard-rules.pro`의 규칙을 확인한다. 앱 클래스 전체와 native 메서드를 그대로 둔다.
  3. `tools/run_all_tests.bat`로 빌드·시험을 돌린다.
  4. `docs/device-checklist.md`의 모든 화면(목록, PLY, 영상, 사진, 진단, PC 소스)을 헤드셋에서 한 번씩 연다.

## 4. 시험과 증거

- `tools/run_all_tests.bat`이 헤드셋 없이 할 수 있는 시험을 모두 돌리고 보고서 한 장을 만든다.
  1. 빈 폴더에서 처음부터 빌드
  2. JVM 단위 시험
  3. image·splat C++ PC 시험
  4. 오픈소스 고지 검사(`qnCheckLicenses`)
  5. APK 요약(크기·ABI·권한·.so·고지 파일·서명)
- C++ PC 시험에는 Visual Studio 2022(C++)가 필요하다. 없으면 그 부분만 건너뛰고 보고서에 SKIPPED로 적는다.
