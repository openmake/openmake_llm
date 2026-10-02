/**
 * 도구 호출 문맥 — 실행 중인 도구 호출의 멱등 키를 호출 경로 아래(외부 MCP 클라이언트)까지 인자 없이 전한다.
 *
 * 에이전트 작업의 외부 도구 호출은 작업·호출 id 로 정해지는 멱등 키를 갖는다(services/agent-task/tool-receipt).
 * 도구 런타임 포트의 시그니처를 바꾸지 않으려고 AsyncLocalStorage 로 싣는다. 문맥 밖(채팅 경로 등)에서는 키가 없다.
 *
 * @module utils/tool-call-context
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface ToolCallContext {
    idempotencyKey: string;
}

const storage = new AsyncLocalStorage<ToolCallContext>();

export function runWithToolCallContext<T>(ctx: ToolCallContext, fn: () => T): T {
    return storage.run(ctx, fn);
}

/** 지금 실행 중인 도구 호출의 멱등 키 — 문맥 밖이면 undefined. */
export function getToolCallIdempotencyKey(): string | undefined {
    return storage.getStore()?.idempotencyKey;
}
