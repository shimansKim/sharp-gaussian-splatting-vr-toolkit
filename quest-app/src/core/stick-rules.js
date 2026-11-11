// 영상·사진 뷰어가 스틱으로 장면(360 구·3D 스크린)을 돌릴 때의 방향 규칙.
// 규칙의 값은 PLY 뷰어와 같은 한 곳(splat-math의 STICK_INVERT)을 쓴다 — 사람 요청(실기기 2026-11-11):
// "조이스틱으로 화면 회전을 상하좌우 반전". 미는 쪽으로 장면이 움직이고 시점은 반대로 돈다.
// 스틱 값 x는 오른쪽 +, y는 위쪽 −(WebXR xr-standard 매핑).
import { STICK_INVERT } from '../viewers/splat/splat-math.js';

/**
 * 스틱 입력을 장면(콘텐츠)의 회전 증분으로 바꾼다. 단위는 라디안.
 * yaw: 장면을 Y축(위)으로 돌리는 양. 반전 규칙에서 스틱이 오른쪽(+x)이면 장면이 오른쪽으로 가도록 음수.
 * pitch: 장면을 X축으로 돌리는 양. 반전 규칙에서 스틱이 위(y<0)이면 장면이 위로 올라가도록 양수.
 * @param {number} x 스틱 가로 값 (-1~1)
 * @param {number} y 스틱 세로 값 (-1~1, 위가 −)
 * @param {number} speed 최대 속도(라디안/초)
 * @param {number} dt 프레임 시간(초)
 * @param {{ x: boolean, y: boolean }} [invert] 기본은 PLY와 같은 STICK_INVERT
 */
export function contentTurnDelta(x, y, speed, dt, invert = STICK_INVERT) {
  const sx = invert.x ? 1 : -1;
  const sy = invert.y ? 1 : -1;
  return { yaw: -sx * x * speed * dt, pitch: -sy * y * speed * dt };
}
