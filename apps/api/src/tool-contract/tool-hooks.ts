/**
 * 도구 실행 훅 레지스트리 (F13.5, 2026-09-17).
 *
 * 도구 디스패처(`tool-dispatch`)에서 서킷·역할 게이트 **뒤**, 실제 호출 **앞(pre)/뒤(post)** 에 돈다.
 * `AGENT_TASK_TOOL_HOOKS=true` 면 에이전트 작업의 task 도구(샌드박스 bash·파일 편집 등 — `TaskRuntime.executeTaskTool`)도
 * 같은 훅을 지난다(`ctx.surface === 'task'`, 하네스 검토 C-08). 기본 OFF — 종전엔 디스패처 경로에만 걸렸다.
 * 훅은 **코드로 등록하는 TS 함수**(L2 config)다 — 디스크·DB 에서 스크립트를 읽지 않는다(임의 코드 실행 표면 금지).
 * 훅 예외는 기본 fail-open(warn 후 통과)이고, `failClosed: true` 로 등록한 훅(보안 검사)만 예외를 거절로 바꾼다 —
 * pre 는 호출을 막고, post 는 결과를 보류한다(이미 실행된 부작용은 되돌리지 못한다).
 * pre 의 `deny` 는 첫 건에서 중단한다. 훅 0개면 비용은 배열 순회뿐.
 *
 * @module tool-contract/tool-hooks
 */
import type { MCPToolResult } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('ToolHooks');

export interface ToolHookContext {
    /** 네임스페이스 포함 도구 이름 */
    name: string;
    external: boolean;
    userId?: string;
    role?: string;
    /** 호출 시작 시각(ms) — post 훅에서 소요 시간 계산용 */
    startedAt: number;
    /** 어느 실행 경로인가 — 'dispatch'(도구 디스패처, 기본) | 'task'(에이전트 작업 task 도구). 없으면 'dispatch'. */
    surface?: 'dispatch' | 'task';
}

export interface ToolHook {
    id: string;
    /** 인자 치환(`args`) 또는 거절(`deny` 메시지). undefined 면 그대로 통과. */
    pre?: (args: Record<string, unknown>, ctx: ToolHookContext) => Promise<{ args?: Record<string, unknown>; deny?: string } | void> | { args?: Record<string, unknown>; deny?: string } | void;
    /** 결과 치환. undefined 면 그대로 통과. */
    post?: (result: MCPToolResult, ctx: ToolHookContext) => Promise<MCPToolResult | void> | MCPToolResult | void;
    /** 보안 훅 — 훅이 예외를 던지면 통과시키지 않는다(pre: 거절, post: 결과 보류). 기본 false(fail-open). */
    failClosed?: boolean;
}

/** fail-closed 훅 예외를 사용자·모델에게 알리는 문구 — 원인 메시지는 로그에만 남긴다(내부 정보 노출 방지). */
export function hookFailureDenyMessage(hookId: string): string {
    return `보안 검사 훅(${hookId})이 오류로 판정하지 못해 실행하지 않았습니다`;
}
export function hookFailureWithheldMessage(hookId: string): string {
    return `보안 검사 훅(${hookId})이 오류로 결과를 검사하지 못해 결과를 보류했습니다(도구는 이미 실행되었을 수 있습니다)`;
}

const hooks: ToolHook[] = [];

/** 등록 — 반환된 함수로 해제. 같은 id 는 교체. */
export function registerToolHook(hook: ToolHook): () => void {
    const i = hooks.findIndex((h) => h.id === hook.id);
    if (i >= 0) hooks[i] = hook; else hooks.push(hook);
    return () => {
        const j = hooks.findIndex((h) => h.id === hook.id);
        if (j >= 0) hooks.splice(j, 1);
    };
}

/** 테스트 전용 */
export function __resetToolHooksForTest(): void {
    hooks.length = 0;
}

export async function runPreHooks(args: Record<string, unknown>, ctx: ToolHookContext): Promise<{ args: Record<string, unknown>; deny?: string }> {
    let current = args;
    for (const h of hooks) {
        if (!h.pre) continue;
        try {
            const r = await h.pre(current, ctx);
            if (!r) continue;
            if (r.deny) return { args: current, deny: r.deny };
            if (r.args) current = r.args;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (h.failClosed) {
                logger.warn(`pre 훅 예외 (fail-closed → 거절) id=${h.id} tool=${ctx.name}: ${msg}`);
                return { args: current, deny: hookFailureDenyMessage(h.id) };
            }
            logger.warn(`pre 훅 예외 (무시) id=${h.id} tool=${ctx.name}: ${msg}`);
        }
    }
    return { args: current };
}

export async function runPostHooks(result: MCPToolResult, ctx: ToolHookContext): Promise<MCPToolResult> {
    let current = result;
    for (const h of hooks) {
        if (!h.post) continue;
        try {
            const r = await h.post(current, ctx);
            if (r) current = r;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (h.failClosed) {
                logger.warn(`post 훅 예외 (fail-closed → 결과 보류) id=${h.id} tool=${ctx.name}: ${msg}`);
                return { content: [{ type: 'text', text: hookFailureWithheldMessage(h.id) }], isError: true };
            }
            logger.warn(`post 훅 예외 (무시) id=${h.id} tool=${ctx.name}: ${msg}`);
        }
    }
    return current;
}
