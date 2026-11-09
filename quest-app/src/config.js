// 앱 설정. 브라우저에 노출돼도 되는 값만 둔다(비밀값 금지).

/** 빌드 base 경로(끝에 / 포함). 코드 안 경로는 항상 이것으로 만든다. */
export const BASE_URL = import.meta.env.BASE_URL;

/** PC 서버(scripts/quest_media_server.py) */
export const PC_SERVER = {
  port: 8787,
  mdnsHost: "sharp-vr.local",
};

/** 서비스 워커 소스 프록시 경로 접두사: `${BASE_URL}__src/<sourceId>/<encoded path>` */
export const SOURCE_PROXY_PREFIX = "__src/";

/** 구글 드라이브(m6, sync-dev). 사람이 H10 설정 뒤 채운다. */
export const GDRIVE = {
  clientId: "",
  apiKey: "",
  appId: "",
};
