// <video> 오류 코드를 사람이 이해할 문장으로 바꾼다.
// MEDIA_ERR_SRC_NOT_SUPPORTED(4)는 코덱 문제뿐 아니라 연결 차단(https 앱에서 http 주소 영상 = 혼합 콘텐츠,
// 사설망 접근 거부)에서도 똑같이 나오므로, 주소가 http이고 앱이 https이면 연결 쪽을 먼저 안내한다.

/**
 * @param {string} url              영상 주소(video.currentSrc 또는 src)
 * @param {string} [pageProtocol]   앱 페이지의 protocol ("https:" 등)
 */
export function isBlockableHttpSource(url, pageProtocol = typeof location !== 'undefined' ? location.protocol : '') {
  if (!url || pageProtocol !== 'https:') return false;
  try {
    return new URL(url, 'https://app.invalid/').protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * @param {{ code?: number, url?: string, pageProtocol?: string, family?: string|null, hint?: string }} info
 */
export function describeVideoError({ code, url = '', pageProtocol, family = null, hint = '' }) {
  if (code === 4) {
    if (isBlockableHttpSource(url, pageProtocol)) {
      return '영상 연결이 막힌 것 같습니다(https 앱에서 http 주소는 브라우저가 차단할 수 있습니다). 앱을 완전히 닫았다가 다시 열고 PC 탭에서 다시 눌러 보세요. 같은 증상이 반복되면 코덱 문제일 수도 있습니다.'.concat(hint ? ` ${hint}` : '');
    }
    return `이 영상은 재생할 수 없습니다(코덱·형식 미지원). ${hint}`.trim();
  }
  if (code === 3) return `영상 디코딩 중 오류가 났습니다. ${hint || (family ? `${family} 영상이 기기 한계를 넘었을 수 있습니다.` : '')}`.trim();
  if (code === 2) return '영상을 받는 중 네트워크 오류가 났습니다. PC 서버가 켜져 있고 같은 Wi-Fi인지 확인하세요.';
  return `영상을 불러오지 못했습니다(오류 ${code ?? '?'}).`;
}
