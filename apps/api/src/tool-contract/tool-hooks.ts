/**
 * 도구 실행 훅 레지스트리 (F13.5, 2026-09-17).
 *
 * `ToolRouter.executeTool` 한 곳에서 서킷·역할 게이트 **뒤**, 실제 호출 **앞(pre)/뒤(post)** 에 돈다.
 * 훅은 **코드로 등록하는 TS 함수**(L2 config)다 — 디스크·DB 에서 스크립트를 읽지 않는다(임의 코드 실행 표면 금지).
 * 훅 예외는 fail-open(warn 후 통과), pre 의 `deny` 는 첫 건에서 중단한다. 훅 0개면 비용은 배열 순회뿐.
 *
 * @module mcp/tool-hooks
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
}

export interface ToolHook {
    id: string;
    /** 인자 치환(`args`) 또는 거절(`deny` 메시지). undefined 면 그대로 통과. */
    pre?: (args: Record<string, unknown>, ctx: ToolHookContext) => Promise<{ args?: Record<string, unknown>; deny?: string } | void> | { args?: Record<string, unknown>; deny?: string } | void;
    /** 결과 치환. undefined 면 그대로 통과. */
    post?: (result: MCPToolResult, ctx: ToolHookContext) => Promise<MCPToolResult | void> | MCPToolResult | void;
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

export function listToolHookIds(): string[] {
    return hooks.map((h) => h.id);
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
            logger.warn(`pre 훅 예외 (무시) id=${h.id} tool=${ctx.name}: ${e instanceof Error ? e.message : e}`);
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
            logger.warn(`post 훅 예외 (무시) id=${h.id} tool=${ctx.name}: ${e instanceof Error ? e.message : e}`);
        }
    }
    return current;
}
