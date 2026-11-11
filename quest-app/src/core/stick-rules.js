// 컨트롤러 스틱으로 화면(시점·영상)을 돌릴 때의 방향 규칙. 영상·사진 뷰어와 PLY 뷰어가 같이 쓴다.
// 사람 요청(실기기 2026-11-11): "조이스틱으로 화면 회전을 상하좌우 반전시켜줘".
// 기존 PLY 규칙은 스틱을 오른쪽으로 밀면 내 시점이 오른쪽으로 도는 것(장면은 왼쪽으로 흐름)이었다.
// 반전 뒤에는 스틱을 미는 쪽으로 장면이 따라간다(오른쪽으로 밀면 장면이 오른쪽으로 흐름).
//
// 스틱 값 x는 오른쪽 +, y는 위쪽 −(WebXR xr-standard 매핑).

/** true면 "장면이 스틱을 따라간다", false면 옛 규칙("시점이 스틱을 따라간다"). */
export const STICK_TURN_INVERTED = true;

/**
 * 스틱 입력을 장면(콘텐츠)의 회전 증분으로 바꾼다. 단위는 라디안.
 * yaw: 장면을 Y축(위)으로 돌리는 양. 스틱이 오른쪽(+x)이면 장면이 오른쪽으로 가도록 음수(위에서 볼 때 시계 방향).
 * pitch: 장면을 X축으로 돌리는 양. 스틱이 위(y<0)이면 장면이 위로 올라가도록 양수.
 * @param {number} x 스틱 가로 값 (-1~1)
 * @param {number} y 스틱 세로 값 (-1~1, 위가 −)
 * @param {number} speed 최대 속도(라디안/초)
 * @param {number} dt 프레임 시간(초)
 */
export function contentTurnDelta(x, y, speed, dt) {
  const sign = STICK_TURN_INVERTED ? 1 : -1;
  return { yaw: -sign * x * speed * dt, pitch: -sign * y * speed * dt };
}

/**
 * 시점(플레이어)을 돌리는 뷰어(PLY)용: 스틱 x에 대한 player.rotation.y 증분.
 * 옛 규칙은 `player.rotation.y -= x * speed * dt`였다. 반전 뒤에는 부호가 반대다.
 */
export function viewYawDelta(x, speed, dt) {
  return (STICK_TURN_INVERTED ? 1 : -1) * x * speed * dt;
}

/** 시점 피치(위아래)용 증분. 스틱 위(y<0) → 장면이 위로(시점은 아래로) 가도록. */
export function viewPitchDelta(y, speed, dt) {
  return (STICK_TURN_INVERTED ? 1 : -1) * y * speed * dt;
}
