/**
 * Request Context - AsyncLocalStorage 기반 요청 컨텍스트 전파
 *
 * Express 미들웨어에서 설정한 requestId를 서비스 레이어, WebSocket 핸들러,
 * 로거까지 암묵적으로 전파합니다. 별도 파라미터 전달 없이 어디서든
 * getRequestId()로 현재 요청의 ID를 조회할 수 있습니다.
 *
 * @module utils/request-context
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
    requestId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * AsyncLocalStorage 컨텍스트 안에서 콜백을 실행합니다.
 * request-id 미들웨어와 WebSocket 핸들러에서 사용합니다.
 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
    return asyncLocalStorage.run(ctx, fn);
}

/**
 * 현재 요청의 requestId를 반환합니다.
 * AsyncLocalStorage 컨텍스트 밖이면 undefined를 반환합니다.
 */
export function getRequestId(): string | undefined {
    return asyncLocalStorage.getStore()?.requestId;
}
