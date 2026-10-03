/**
 * 비용 귀속 문맥 — 지금 실행 중인 작업의 세션 id 를 호출 경로 아래(비용 원장 적재)까지 인자 없이 전한다.
 *
 * 외부 모델 사용분은 role 해석기가 만든 클라이언트의 사용량 훅에서 원장에 적재되는데, 그 훅은 어느 작업의 호출인지 모른다.
 * 클라이언트·해석기 시그니처를 바꾸지 않으려고 AsyncLocalStorage 로 싣는다(utils/tool-call-context 와 같은 방식).
 * 문맥 밖에서는 세션 id 가 없다.
 *
 * @module utils/cost-attribution-context
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ sessionId: string }>();

export function runWithCostSession<T>(sessionId: string, fn: () => T): T {
    return storage.run({ sessionId }, fn);
}

/** 지금 실행 중인 작업의 세션 id — 문맥 밖이면 undefined. */
export function getCostSessionId(): string | undefined {
    return storage.getStore()?.sessionId;
}
