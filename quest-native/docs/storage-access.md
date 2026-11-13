# 기기 저장소 접근 방식

quest-native가 헤드셋 안의 파일(PLY·영상·사진)을 어떻게 읽는지와 그 이유를 적는다.
코드: `app/src/main/java/com/sharp/questnative/source/DeviceSource.java`

## 결론

두 가지 방법을 함께 둔다.

| 방법 | 무엇을 보나 | 권한 | Meta 스토어 |
|---|---|---|---|
| **폴더 고르기**(Storage Access Framework, `ACTION_OPEN_DOCUMENT_TREE`) | 사용자가 고른 폴더와 그 하위 | 없음(고른 폴더의 읽기 권한을 영구 보관) | 심사 없이 통과 |
| **모든 파일 접근**(`MANAGE_EXTERNAL_STORAGE`) | 공유 저장소 전체 | 설정 화면에서 사용자가 켬 | **심사 필요**. 허용 용도는 "file management features"다 |

- 목록 패널의 "이 기기"에 아무 폴더도 없으면 두 버튼(폴더 고르기, 모든 파일 접근)이 있는 안내 카드가 뜬다.
- 고른 폴더는 앱을 다시 켜도 남는다(`takePersistableUriPermission`).
- 사이드로드 판은 지금처럼 두 방법을 모두 쓴다.
  스토어 판은 두 가지 중 하나를 고른다.
  - 사유를 적고 `MANAGE_EXTERNAL_STORAGE` 심사를 받는다.
  - 매니페스트에서 그 권한을 빼고 폴더 고르기만 남긴다.
  - 결정은 스토어 출시 미션에서 한다.

## 근거

- Meta "Review-requiring Android permissions"(https://developers.meta.com/vr/resources/permissions-review-required/)
  - `MANAGE_EXTERNAL_STORAGE`: "Permitted uses include file management features."
  - `READ_EXTERNAL_STORAGE`: "Not needed to read shared storage media files or media files created by your app itself."
  - `READ_MEDIA_VIDEO` / `READ_MEDIA_IMAGES`: "Access videos/images created by other apps."
  - 이 권한들을 쓰면 앱 제출 때 용도를 설명해야 한다.
- VRC.Quest.Security.2(https://developers.meta.com/horizon/resources/vrc-quest-security-2/)
  - 앱은 동작에 필요한 최소 권한만 요청해야 한다.
  - 런타임 권한을 거부해도 앱이 죽거나 멈추면 안 된다.

## 다른 방법을 쓰지 않은 이유

- **`READ_MEDIA_VIDEO`·`READ_MEDIA_IMAGES`(MediaStore)**: 다른 앱이 만든 사진·영상만 보인다.
  `.ply`·`.spz` 같은 파일은 미디어가 아니라서 목록에 나오지 않는다.
  이 앱의 핵심 파일(PLY)을 못 보므로 주 경로로 쓰지 않는다.
- **`READ_EXTERNAL_STORAGE`**: Android 13 이상(Quest는 Android 14 기반)에서는 미디어 외 파일에 효과가 없다.

## 사용자 경험(Quest)

- 두 버튼 모두 시스템 2D 화면(폴더 선택기, 설정)을 연다.
  그동안 몰입 화면에서 잠시 나갔다가, 끝나면 앱으로 돌아온다(`QnActivity.startForResult`).
- `ACTION_OPEN_DOCUMENT_TREE`는 Android 11부터 저장소 맨 위와 `Download` 폴더 자체를 고를 수 없다.
  `Download/SHARP`처럼 하위 폴더를 고르라고 안내해야 한다. **[추정, 실기기 확인 필요]**
- 운영체제 업데이트 때 "모든 파일 접근"이 꺼졌다는 제3자 보고가 있다(근거 약함).
  꺼지면 목록이 비고 안내 카드가 다시 뜬다.

## 실기기에서 확인할 것

- 폴더 선택기와 설정 화면이 몰입 앱에서 열리고 돌아오는지
- 고른 폴더의 영구 권한이 재부팅 뒤에도 남는지
- 큰 폴더(수천 개)를 SAF로 읽는 속도
