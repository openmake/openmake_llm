/**
 * 장기 실행 체인 예산 해석(PURE) — 생성 요청의 longRunning 을 LongRunningBudget 으로.
 * 기본값을 넘는 값은 관리자만, 절대 상한은 누구도 못 넘는다. 비용 폭주 방지의 첫 관문.
 *
 * @module services/agent-task/long-running-budget
 */
import { AGENT_TASK_LONG_RUNNING as C } from '../../config/agent-task-long-running';
import type { LongRunningBudget } from './types';

export interface LongRunningRequest {
    maxDurationMs?: number;
    maxTotalTokens?: number;
    maxSegments?: number;
}

type Resolved = { ok: true; budget: LongRunningBudget } | { ok: false; reason: string };

function pick(name: string, v: number | undefined, def: number, max: number, isAdmin: boolean): { value: number } | { reason: string } {
    if (v === undefined) return { value: def };
    if (!Number.isInteger(v) || v <= 0) return { reason: `${name} 은 1 이상의 정수여야 합니다` };
    if (v > max) return { reason: `${name} 은 절대 상한 ${max} 를 넘을 수 없습니다` };
    if (v > def && !isAdmin) return { reason: `${name} 이 기본값 ${def} 을 넘습니다 — 관리자만 올릴 수 있습니다` };
    return { value: v };
}

export function resolveLongRunningBudget(input: LongRunningRequest, role: string, now: number): Resolved {
    const isAdmin = role === 'admin';
    const ms = pick('maxDurationMs', input.maxDurationMs, C.DEFAULT_MS, C.MAX_MS, isAdmin);
    if ('reason' in ms) return { ok: false, reason: ms.reason };
    const tokens = pick('maxTotalTokens', input.maxTotalTokens, C.DEFAULT_TOKENS, C.MAX_TOKENS, isAdmin);
    if ('reason' in tokens) return { ok: false, reason: tokens.reason };
    const segments = pick('maxSegments', input.maxSegments, C.DEFAULT_SEGMENTS, C.MAX_SEGMENTS, isAdmin);
    if ('reason' in segments) return { ok: false, reason: segments.reason };
    return { ok: true, budget: { maxDurationMs: ms.value, maxTotalTokens: tokens.value, maxSegments: segments.value, startedAt: now } };
}

/** 생성 라우트 게이트(PURE) — enabled 는 호출부가 AGENT_TASK_LONG_RUNNING.ENABLED 를 넘긴다(테스트에서 바꾸기 쉽게). */
export function longRunningCreateGate(
    input: LongRunningRequest | undefined, role: string, now: number, enabled: boolean,
): { ok: true; fields: { longRunning?: LongRunningBudget } } | { ok: false; reason: string } {
    if (input === undefined) return { ok: true, fields: {} };
    if (!enabled) return { ok: false, reason: '장기 실행 체인 기능이 꺼져 있습니다 (AGENT_TASK_LONG_RUNNING)' };
    const resolved = resolveLongRunningBudget(input, role, now);
    return resolved.ok ? { ok: true, fields: { longRunning: resolved.budget } } : resolved;
}
