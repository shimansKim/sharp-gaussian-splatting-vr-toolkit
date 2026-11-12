// 앱 설정. 브라우저에 노출돼도 되는 값만 둔다(비밀값 금지).

/** 빌드 base 경로(끝에 / 포함). 코드 안 경로는 항상 이것으로 만든다. */
export const BASE_URL = import.meta.env.BASE_URL;

/**
 * 스토어판 빌드인가(Meta Horizon Store 제출용). 빌드할 때 VITE_STORE_BUILD=1 로 켠다. 기본은 꺼짐(지금 Pages 배포).
 * 켜지면: Cloudflare 터널(https 주소) 연결을 받지 않고, 일반 브라우저로 직접 열면 "Horizon Store에서 설치하세요" 안내만 보인다
 * (판별: core/store-gate.js, 진입: store-entry.js, 진입 교체: vite.config.js).
 */
export const STORE_BUILD = ["1", "true"].includes(String(import.meta.env?.VITE_STORE_BUILD ?? "").toLowerCase());

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
