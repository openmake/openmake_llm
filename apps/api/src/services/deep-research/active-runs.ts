/**
 * Deep Research — REST 경로 실행 중 세션의 AbortController 레지스트리 (프로세스 메모리).
 *
 * 2026-09-05: `POST /sessions/:id/execute` 가 abort signal 을 배선하지 않아 REST 로 시작한
 * 리서치는 취소할 수 없었다(채팅 경로만 WS disconnect 로 중단). 실행 시 등록하고
 * `POST /sessions/:id/cancel`·`DELETE` 가 abort 한다. 다중 인스턴스 환경이면 같은 프로세스가
 * 아닐 수 있어 "이 프로세스에서 실행 중이 아님" 은 404 가 아니라 false 로 돌려준다.
 *
 * @module services/deep-research/active-runs
 */

const controllers = new Map<string, AbortController>();

/** 실행 시작 — 같은 세션이 이미 있으면 기존 것을 abort 하고 교체 */
export function registerActiveRun(sessionId: string): AbortController {
    const prev = controllers.get(sessionId);
    if (prev) prev.abort();
    const controller = new AbortController();
    controllers.set(sessionId, controller);
    return controller;
}

/** 실행 종료(성공·실패·취소 모두) — 등록된 컨트롤러와 동일할 때만 제거 */
export function unregisterActiveRun(sessionId: string, controller?: AbortController): void {
    if (controller && controllers.get(sessionId) !== controller) return;
    controllers.delete(sessionId);
}

/** 취소 요청 — 이 프로세스에서 실행 중이면 abort 후 true */
export function abortActiveRun(sessionId: string): boolean {
    const controller = controllers.get(sessionId);
    if (!controller) return false;
    controller.abort();
    controllers.delete(sessionId);
    return true;
}

export function isActiveRun(sessionId: string): boolean {
    return controllers.has(sessionId);
}
