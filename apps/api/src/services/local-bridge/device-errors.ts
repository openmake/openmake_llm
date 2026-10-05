/**
 * 로컬 기기 오류 — 레지스트리·실행기를 끌어오지 않고 판별할 수 있게 따로 둔다.
 * @module services/local-bridge/device-errors
 */

/** 작업이 쓸 로컬 기기가 연결돼 있지 않다 — 실행기를 준비하지 못했다(기기 대기의 근거). */
export class LocalDeviceUnavailableError extends Error {
    constructor() {
        super('연결된 로컬 디바이스가 없습니다 — 데스크톱 앱 또는 CLI 로 작업 폴더를 먼저 연결하세요.');
        this.name = 'LocalDeviceUnavailableError';
    }
}

/**
 * 도구 실행 중 기기가 사라졌다는 신호 — 기기 대기 주차의 방식이 갈린다.
 *   rerunnable : 요청이 기기에 닿지 않았거나 읽기였다. 결과를 남기지 않고 주차하고 재개 때 다시 실행한다.
 *   unknown    : 쓰기·실행 요청을 보낸 뒤 끊겼다. 결과 불명 안내를 남기고 주차한다(다시 실행하지 않는다).
 *   browser_takeover : 기기는 그대로지만 사용자가 브라우저를 넘겨받아 요청을 실행하지 않고 거절했다(2026-10-05).
 *                      결과를 남기지 않고 넘겨받기 사유로 주차하고, 돌려받으면 같은 호출을 다시 실행한다.
 */
export type DeviceLoss = 'rerunnable' | 'unknown' | 'browser_takeover';
