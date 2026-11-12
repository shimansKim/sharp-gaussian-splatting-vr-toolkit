// 공용 UI 상태: (1) 모든 UI(공용 VR 패널·미디어 재생 컨트롤·PLY 안내)를 한꺼번에 켜고 끄는 스위치, (2) UI가 놓이는 "한 자리"(앵커).
//
// 원칙(사람 요청 2026-11-12): UI는 저절로 따라오거나 옮겨지지 않는다. 앵커는 사람이 명시적으로 재배치할 때만 바뀐다
//  - VR 세션이 시작되고 헤드셋 자세가 들어온 뒤(POSE_FRAMES 프레임) 한 번: 그 순간의 머리 위치·정면 방향 기준으로 잡힌다(세션마다 새로).
//    그 전에는 앵커가 없고 reference()는 지금 시선을 그대로 돌려줄 뿐 저장하지 않는다(세션 시작 직후 카메라가 아직 바닥·뒤쪽을 볼 때 잘못 고정되는 것을 막는다).
//  - 이후: B/Y 길게 누르기 또는 패널의 [여기로 옮기기] → relocate()만이 앵커를 바꾼다. 켜고 끄기·파일 열기·형식 바꾸기·머리 돌리기는 앵커를 건드리지 않는다.
//
// 앵커는 플레이어 그룹(카메라의 부모) 기준 좌표로 저장한다 = 실제 방(트래킹 공간)에 고정. 머리를 돌려도 따라오지 않고,
// PLY에서 스틱으로 걸어 다니면(player가 움직이면) 같이 옮겨진다. 월드 좌표가 필요하면 reference(camera)로 얻는다.
//
// ── 뷰어·HUD가 쓰는 인터페이스 ─────────────────────────────────────────────────
//   import { ui } from "../../core/ui-state.js";
//   ui.visible                      → boolean. false면 UI를 그리지 않는다(켜기 전에는 어떤 경로로도 새로 띄우지 않는다).
//   on("ui:visibility", ({ visible }) => …)  → 켜고 끌 때 한 번씩. 꺼질 때 "지금 보이던 것"을 기억했다가 켜질 때 되살린다.
//   ui.reference(camera)            → { head: Vector3(월드), yaw }. dockTop(head, yaw)·dockRotation(yaw)에 그대로 넣으면
//                                     panel-layout.js의 도크 자리가 된다. 세션 시작 직후(앵커 잡히기 전)에는 지금 시선을 돌려준다. 이 값으로 HUD를 놓으면
//                                     공용 패널과 항상 같은 자리다. 호출해도 앵커는 바뀌지 않는다.
//   on("ui:anchor", ({ reason }) => …)       → 앵커가 정해졌을 때: 세션 시작 뒤 처음 잡힐 때(reason "session")와 사람이 재배치했을 때("relocate"). HUD는 여기서 다시 놓는다(그 밖에는 다시 놓지 않는다).
//   ui.relocate(camera)             → 사람의 명시 동작에서만 부른다(B/Y 길게·[여기로 옮기기]). 앵커를 지금 시선으로 옮기고 UI를 켠다.

import { Vector3 } from "three";
import { emit } from "./events.js";

const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** 카메라의 부모(플레이어 그룹)의 월드 행렬. 부모가 없으면 단위 행렬로 본다. */
function parentOf(camera) {
  camera.parent?.updateMatrixWorld?.(true);
  return camera.parent ?? null;
}

/** 시선 방향의 수평각(정면 -z가 0, 왼쪽이 양수). */
function yawOf(direction) {
  return Math.atan2(-direction.x, -direction.z);
}

/** 세션이 시작된 뒤 이만큼 프레임이 지나야 카메라가 헤드셋 자세를 받은 것으로 본다(three는 첫 프레임 그리기에서야 갱신한다). */
export const POSE_FRAMES = 3;

/**
 * @param {{ emit?: (name: string, detail?: any) => void }} [options]
 */
export function createUiState({ emit: send = emit } = {}) {
  let visible = true;
  /** 공용 VR 패널을 사람이 열어 둔 상태(의도). 같은 자리를 쓰는 재생 컨트롤 등이 겹쳐 뜨지 않도록 읽는다. */
  let panelOpen = false;
  /** 플레이어 기준 좌표의 머리 기준점과 방향. null이면 아직 안 잡혔다. */
  let anchor = null;
  let framesPresenting = 0;

  const tmpDir = new Vector3();
  const tmpHead = new Vector3();

  function capture(camera) {
    camera.updateMatrixWorld(true);
    const parent = parentOf(camera);
    camera.getWorldPosition(tmpHead);
    camera.getWorldDirection(tmpDir);
    tmpDir.y = 0;
    if (tmpDir.lengthSq() < 1e-4) tmpDir.set(0, 0, -1);
    tmpDir.normalize();
    const head = tmpHead.clone();
    if (parent) {
      parent.worldToLocal(head);
      tmpDir.transformDirection(parent.matrixWorld.clone().invert());
      tmpDir.y = 0;
      if (tmpDir.lengthSq() < 1e-4) tmpDir.set(0, 0, -1);
      tmpDir.normalize();
    }
    return { x: head.x, y: head.y, z: head.z, yaw: yawOf(tmpDir) };
  }

  return {
    get visible() {
      return visible;
    },
    /** @param {boolean} next */
    setVisible(next) {
      next = !!next;
      if (next === visible) return visible;
      visible = next;
      send("ui:visibility", { visible });
      return visible;
    },
    toggle() {
      return this.setVisible(!visible);
    },

    /** 공용 패널이 열려 있는가. true인 동안 같은 자리의 다른 창(미디어 재생 컨트롤)은 띄우지 않는다(한 번에 한 창만). */
    get panelOpen() {
      return panelOpen;
    },
    setPanelOpen(next) {
      panelOpen = !!next;
    },

    get hasAnchor() {
      return anchor !== null;
    },
    /** 저장된 앵커(플레이어 기준). 없으면 null. 검증·테스트용 복사본. */
    get anchor() {
      return anchor ? { ...anchor } : null;
    },
    /** VR 세션이 시작·끝날 때 부른다: 앵커를 비워 새 세션의 머리 자세로 다시 잡게 한다. UI는 켠 상태로 돌린다. */
    resetForSession() {
      anchor = null;
      framesPresenting = 0;
      panelOpen = false;
      this.setVisible(true);
    },
    /** 매 프레임 호출. 세션 시작 뒤 자세가 들어오면 앵커를 한 번 잡는다. */
    tick(camera, presenting) {
      if (!presenting) {
        framesPresenting = 0;
        return;
      }
      framesPresenting += 1;
      if (!anchor && framesPresenting >= POSE_FRAMES) {
        anchor = capture(camera);
        send("ui:anchor", { reason: "session" });
      }
    },

    /**
     * 월드 좌표의 도크 기준 { head, yaw }. 앵커가 정해진 뒤에는 늘 같은 자리(머리를 돌려도 같다).
     * @param {import('three').Camera} camera
     * @returns {{ head: Vector3, yaw: number }}
     */
    reference(camera) {
      const a = anchor ?? capture(camera); // 아직 안 잡혔으면 지금 시선(저장하지 않음)
      const parent = parentOf(camera);
      const head = new Vector3(a.x, a.y, a.z);
      let yaw = a.yaw;
      if (parent) {
        parent.localToWorld(head);
        const dir = new Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)).transformDirection(parent.matrixWorld);
        yaw = yawOf(dir);
      }
      return { head, yaw: wrap(yaw) };
    },

    /**
     * 사람이 명시적으로 요청했을 때만: 앵커를 지금 머리 위치·정면으로 옮기고 UI를 켠다.
     * @param {import('three').Camera} camera
     */
    relocate(camera) {
      anchor = capture(camera);
      send("ui:anchor", { reason: "relocate" });
      this.setVisible(true);
    },
  };
}

/** 앱 전체가 같이 쓰는 하나의 상태. */
export const ui = createUiState();
