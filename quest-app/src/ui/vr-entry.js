// 영상·사진을 열면 바로 VR로 들어가는 규칙과 설정 저장. DOM 없이 검증할 수 있게 순수 함수로 둔다.
// 배경(실기기 2026-11-12): 사람이 2D 브라우저 창에서 영상·사진을 보고 "입체가 아니다·끊긴다"고 느꼈다.
// 2D 미리보기는 SBS 3D의 왼쪽 눈 그림만 보여 주므로 입체일 수 없다. VR 세션에 들어가야 눈별 그림이 나간다.

const KEY = 'sharp.autoVrMedia';

/** 열면 바로 VR로 들어갈 종류(PLY는 사람이 이미 VR 버튼으로 잘 보고 있어 바꾸지 않는다). */
export const AUTO_VR_KINDS = ['video', 'image'];

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 설정: 기본 켬. 사람이 끄면 '0'으로 기억한다. */
export function readAutoVr() {
  try {
    return storage()?.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeAutoVr(on) {
  try {
    storage()?.setItem(KEY, on ? '1' : '0');
  } catch {
    // 저장이 막혀도 이번 실행 동안은 화면의 체크 상태를 따른다.
  }
}

/**
 * 목록에서 항목을 눌렀을 때 곧바로 VR 세션을 요청할지.
 * @param {{ kind?: string, enabled: boolean, supported: boolean, presenting: boolean }} input
 */
export function shouldAutoEnterVr({ kind, enabled, supported, presenting }) {
  return !!enabled && !!supported && !presenting && AUTO_VR_KINDS.includes(kind ?? '');
}

/**
 * 2D 화면 가운데에 크게 띄우는 'VR로 보기' 안내를 보일지(영상·사진이 열려 있고 아직 VR 밖일 때).
 * isSessionSupported가 false여도(기기 상태에 따라 잘못 false가 나올 수 있다) WebXR API가 있으면 누르면 시도해 보게 한다.
 */
export function shouldShowVrPrompt({ kind, hasXr, presenting, dismissed }) {
  return !dismissed && !!hasXr && !presenting && AUTO_VR_KINDS.includes(kind ?? '');
}
