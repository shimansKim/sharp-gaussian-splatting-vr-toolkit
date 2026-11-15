# 사용자 사이트 배포

`store-site/`의 정책·지원·다운로드 페이지는 `.github/workflows/store-deploy.yml`이 사용자 사이트에 배포한다.
`main`에서 관련 파일이 바뀌거나 수동 실행할 때 배포한다.
풀 리퀘스트에서는 배포하지 않는다.

배포 키의 개인 키는 `USER_SITE_DEPLOY_KEY` 시크릿에 있다.
공개 키는 사용자 사이트 저장소의 쓰기 가능한 Deploy key다.
`downloads/`의 PC 서버 배포 파일은 별도 워크플로가 관리한다.
