# 사용자 사이트

`store-site/sharp-quest/`의 정책·지원·다운로드 페이지를 사용자 사이트의 `/sharp-quest/`에 배포한다.
배포할 때 해당 디렉터리만 동기화하고 사용자 사이트의 다른 파일은 보존한다.
`/downloads/pc-server.json`과 PC 서버 릴리스는 별도 워크플로가 관리한다.
`store-site/.github/workflows/pc-server-release.yml`은 릴리스 전용 브랜치에 복사한다.
