# shimansKim.github.io

> **폐기 결정:** 웹 앱·스토어 준비물은 폐기 결정됐으며 파일은 아직 남아 있다. 새 작업 대상이 아니다.
> Quest 네이티브 뷰어는 [Splatia](../quest-native/README.md)를 본다.

SHARP Quest 뷰어(Meta Quest용 TWA 앱)가 여는 공개 사이트입니다.
이 저장소의 파일은 앱 저장소의 `store-site/` 폴더와 `quest-app` 스토어판 빌드에서 자동으로 배포됩니다. 여기서 직접 고치면 다음 배포 때 덮어써집니다.

- `/.well-known/assetlinks.json`: 앱 서명 키 지문(Digital Asset Links). 앱 위쪽 주소 표시줄을 없앱니다.
- `/sharp-gaussian-splatting-vr-toolkit/`: 스토어판 앱 파일.
- `/sharp-quest/`: 개인정보처리방침(`privacy/`), 이용약관(`terms/`), 지원(`support/`) 페이지(한국어·영어).
- `.nojekyll`: `.well-known` 폴더가 빠지지 않게 Jekyll 처리를 끕니다.
