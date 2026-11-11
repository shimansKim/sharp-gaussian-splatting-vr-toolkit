// 공통 모듈 계약 (notes/quest-app-design.md 7.3).
// 소유: app-dev. 계약을 바꾸려면 commander에게 먼저 알리고 설계 문서 7.3도 같이 고친다.
// 이 파일은 JSDoc 타입만 담는다. 런타임 코드는 없다.

/**
 * 목록 항목.
 * @typedef {object} LibraryItem
 * @property {string} id                 `${sourceId}:${path 또는 파일 id}` (소스 안에서 유일)
 * @property {SourceId} sourceId
 * @property {string} name               표시 이름(파일 이름)
 * @property {ItemKind} kind
 * @property {number} [size]             바이트
 * @property {string} [mime]
 * @property {number} [mtime]            epoch ms
 * @property {MediaLayout} [layout]      media 전용, 판별값 또는 사용자 지정
 * @property {string} [path]             소스 안의 경로(pc·gdrive), 표시·재열기용
 */

/** @typedef {'session'|'library'|'pc'|'gdrive'} SourceId */

/** @typedef {'splat'|'video'|'image'} ItemKind */

/**
 * @typedef {'mono2d'|'mono360'|'tb360'|'sbs360'|'sbs180'|'mono180'|'sbsScreenFull'|'sbsScreenHalf'|'tbScreen'} MediaLayout
 */

/**
 * 소스: 목록과 열기.
 * @typedef {object} Source
 * @property {SourceId} id
 * @property {string} label
 * @property {(path?: string) => Promise<{ items: LibraryItem[], dirs?: string[] }>} list
 * @property {(item: LibraryItem) => Promise<OpenedFile>} open
 */

/**
 * 열린 파일. 뷰어는 필요한 것만 쓴다.
 * @typedef {object} OpenedFile
 * @property {string} url                blob: 또는 __src 프록시 URL (영상·사진)
 * @property {() => Promise<ReadableStream<Uint8Array>>} [stream]  PLY용. 호출할 때마다 새 스트림
 * @property {number} [size]
 * @property {string} name
 * @property {string} [mime]
 * @property {() => void} release        blob URL 해제 등. 뷰어 unload 뒤 library가 부른다
 */

/**
 * 한 손 컨트롤러 입력(매 프레임 갱신).
 * 축은 데드존 적용 뒤 값이다. *Pressed는 이번 프레임에 눌리기 시작했을 때만 true(에지).
 * Quest Touch: primary = X(왼쪽)/A(오른쪽), secondary = Y(왼쪽)/B(오른쪽).
 * @typedef {object} XrHandInput
 * @property {boolean} connected
 * @property {number} x                  스틱 좌우 -1..1
 * @property {number} y                  스틱 상하 -1..1 (앞으로 밀면 음수)
 * @property {number} trigger            0..1
 * @property {number} grip               0..1
 * @property {boolean} primary
 * @property {boolean} secondary
 * @property {boolean} stick             스틱 누르기(L3/R3)
 * @property {boolean} stickPressed      스틱을 누르기 시작한 프레임만 true
 * @property {boolean} primaryPressed
 * @property {boolean} secondaryPressed
 * @property {boolean} triggerPressed    trigger가 0.6을 넘는 순간
 * @property {boolean} gripPressed       grip이 0.6을 넘는 순간
 */

/**
 * @typedef {object} XrInput
 * @property {boolean} presenting        XR 세션 안이면 true
 * @property {XrHandInput} left
 * @property {XrHandInput} right
 */

/**
 * xr-stage가 뷰어에게 주는 무대.
 * - 뷰어는 자기 객체를 `content` 그룹 아래에만 붙이고 unload에서 떼어 낸다.
 * - `player`는 카메라와 컨트롤러를 담는 이동 그룹이다. 이동·회전은 뷰어가 update에서 한다.
 * - 공통 버튼(X/A 이전·다음, B/Y 패널)은 library/vr-panel이 처리하므로 뷰어는 쓰지 않는다.
 * @typedef {object} XrStage
 * @property {import('three').WebGLRenderer} renderer
 * @property {import('three').Scene} scene
 * @property {import('three').PerspectiveCamera} camera
 * @property {import('three').Group} player
 * @property {import('three').Group} content
 * @property {() => boolean} isPresenting
 * @property {() => Promise<void>} enterVR   사용자 제스처 안에서 호출
 * @property {() => Promise<void>} exitVR
 * @property {() => void} resetPlayer        player 위치·회전 초기화
 */

/**
 * 뷰어: xr-stage 위에 붙는다.
 * @typedef {object} Viewer
 * @property {ItemKind[]} kinds
 * @property {(stage: XrStage) => void} mount            앱 시작 때 한 번
 * @property {(item: LibraryItem, file: OpenedFile) => Promise<void>} load
 * @property {() => void} unload
 * @property {(dt: number, input: XrInput) => void} update   매 프레임(XR 밖에서도 불림, input.presenting=false)
 * @property {() => Array<{ id: string, label: string, run: () => void }>} [panelActions]  VR 패널 버튼
 * @property {() => void} [resetView]                    VR 패널 "위치 초기화"가 부른다(없으면 stage.resetPlayer)
 * @property {() => { yawOffset?: number, distance?: number, avoidYaw?: number, avoidHalf?: number }} [panelPlacement]
 *   VR 패널을 열 때 배치. yawOffset(시선 기준 라디안, 양수=왼쪽) 또는 피할 장면의 방향 avoidYaw·반폭 avoidHalf(패널이 그 바깥으로 비켜 열림)
 */

export {};
