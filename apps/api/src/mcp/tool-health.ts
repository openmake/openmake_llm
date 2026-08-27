/**
 * 도구 서킷 브레이커 — 반복 실패하는 도구를 노출·실행에서 일시 차단한다.
 *
 * 상태: CLOSED → (창 안 실패 임계 도달) → OPEN → (cooldown 경과) → HALF_OPEN
 *       → 성공이면 CLOSED, 실패면 다시 OPEN(cooldown ×backoff, 상한까지).
 *
 * `cluster/circuit-breaker.ts` 를 재사용하지 않은 이유: 그 클래스는 `CircuitOpenError` 를
 * **던지는 실행 래퍼**라 목적이 다르다(여기서는 노출 필터가 주 효과이고, 실행 거절은
 * 모델이 기억한 이름으로 호출할 때의 2차 방어다). 상태 전이 규칙만 참조했다.
 *
 * 메모리 관리: **실패만 엔트리를 만든다**. 성공은 기존 엔트리가 있을 때만 갱신하므로,
 * 정상 도구가 Map 을 채우지 않는다. 상한 도달 시 가장 오래 손대지 않은 항목을 버린다.
 *
 * @module mcp/tool-health
 */
import { TOOL_CIRCUIT } from '../config/tool-health';
import { MCP_NAMESPACE_SEPARATOR } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('ToolCircuit');

export type ToolCircuitState = 'closed' | 'open' | 'half_open';

interface CircuitEntry {
    /** 창 안 실패 시각(ms). 창을 벗어나면 잘라낸다. */
    failures: number[];
    /** 창 안 호출 시각(ms) — MIN_CALLS 판정용. */
    calls: number[];
    state: ToolCircuitState;
    /** OPEN 이 된 시각. */
    openedAt: number;
    /** 이번 OPEN 의 차단 시간(ms) — 재차단마다 backoff 로 늘어난다. */
    openMs: number;
    /** 마지막 접근 시각 — 상한 초과 시 축출 기준. */
    touchedAt: number;
    /** 마지막 실패 분류(관측용). */
    lastCategory?: string;
}

const entries = new Map<string, CircuitEntry>();

/** 이 도구가 서킷 대상인지 — 범위 설정(내장 제외)이 여기서만 적용된다. */
function inScope(tool: string): boolean {
    if (TOOL_CIRCUIT.SCOPE === 'all') return true;
    return tool.includes(MCP_NAMESPACE_SEPARATOR);
}

function trim(list: number[], now: number): number[] {
    const cutoff = now - TOOL_CIRCUIT.WINDOW_MS;
    return list.filter((t) => t > cutoff);
}

function evictIfNeeded(): void {
    if (entries.size <= TOOL_CIRCUIT.MAX_TRACKED_TOOLS) return;
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [k, v] of entries) {
        if (v.touchedAt < oldest) { oldest = v.touchedAt; oldestKey = k; }
    }
    if (oldestKey) entries.delete(oldestKey);
}

/**
 * 도구가 현재 차단 상태인지. cooldown 이 지났으면 HALF_OPEN 으로 전이시키고 통과시킨다
 * (한 번의 실제 호출로 복구 여부를 판정 — 그 결과는 recordToolResult 가 받는다).
 */
export function isToolCircuitOpen(tool: string): boolean {
    if (!TOOL_CIRCUIT.ENABLED || !inScope(tool)) return false;
    const e = entries.get(tool);
    if (!e || e.state === 'closed') return false;

    const now = Date.now();
    e.touchedAt = now;
    if (e.state === 'open' && now - e.openedAt >= e.openMs) {
        e.state = 'half_open';
        logger.info(`[circuit] half-open 전이 — ${tool} (차단 ${Math.round(e.openMs / 1000)}s 경과)`);
        return false;
    }
    return e.state === 'open';
}

/**
 * 도구 실행 결과 기록. 실패 분류가 제외 목록(모델 실수·대상 부재 등)이면 세지 않는다 —
 * 도구 고장이 아닌 실패로 정상 도구를 차단하는 것이 이 기능의 최악 실패 모드다.
 */
export function recordToolResult(tool: string, ok: boolean, category?: string): void {
    if (!TOOL_CIRCUIT.ENABLED || !inScope(tool)) return;
    const now = Date.now();

    if (ok) {
        const e = entries.get(tool);
        if (!e) return; // 정상 도구는 엔트리를 만들지 않는다(메모리 무한 증가 방지).
        e.touchedAt = now;
        e.calls = [...trim(e.calls, now), now];
        e.failures = trim(e.failures, now);
        if (e.state !== 'closed') {
            logger.info(`[circuit] 복구 — ${tool} (${e.state} → closed)`);
        }
        e.state = 'closed';
        e.failures = [];
        return;
    }

    if (category && TOOL_CIRCUIT.EXCLUDED_CATEGORIES.includes(category)) {
        // 실패지만 도구 탓이 아니다. 엔트리가 없으면 만들지도 않는다.
        const existing = entries.get(tool);
        if (existing) { existing.touchedAt = now; existing.calls = [...trim(existing.calls, now), now]; }
        return;
    }

    const e = entries.get(tool) ?? {
        failures: [], calls: [], state: 'closed' as ToolCircuitState,
        openedAt: 0, openMs: TOOL_CIRCUIT.OPEN_MS, touchedAt: now,
    };
    e.touchedAt = now;
    e.lastCategory = category;
    e.calls = [...trim(e.calls, now), now];
    e.failures = [...trim(e.failures, now), now];

    const wasHalfOpen = e.state === 'half_open';
    if (wasHalfOpen) {
        // 복구 시도가 다시 실패 — 차단 시간을 늘려 재차단.
        e.openMs = Math.min(e.openMs * TOOL_CIRCUIT.OPEN_BACKOFF_FACTOR, TOOL_CIRCUIT.OPEN_MS_MAX);
        e.state = 'open';
        e.openedAt = now;
        logger.warn(`[circuit] 재차단 — ${tool} (${Math.round(e.openMs / 1000)}s, 분류=${category ?? 'unknown'})`);
    } else if (
        e.state === 'closed'
        && e.failures.length >= TOOL_CIRCUIT.FAILURE_THRESHOLD
        && e.calls.length >= TOOL_CIRCUIT.MIN_CALLS
    ) {
        e.state = 'open';
        e.openedAt = now;
        logger.warn(`[circuit] 차단 — ${tool} (창 내 실패 ${e.failures.length}/${e.calls.length}회, ${Math.round(e.openMs / 1000)}s, 분류=${category ?? 'unknown'})`);
    }

    entries.set(tool, e);
    evictIfNeeded();
}

/** 관측용 스냅샷 — closed 로 돌아온 엔트리도 최근 실패 이력을 보여주기 위해 포함한다. */
export function getCircuitSnapshot(): Array<{
    tool: string;
    state: ToolCircuitState;
    failuresInWindow: number;
    callsInWindow: number;
    openMs: number;
    opensInMs: number | null;
    lastCategory?: string;
}> {
    const now = Date.now();
    return [...entries.entries()]
        .map(([tool, e]) => ({
            tool,
            state: e.state,
            failuresInWindow: trim(e.failures, now).length,
            callsInWindow: trim(e.calls, now).length,
            openMs: e.openMs,
            // OPEN 이면 해제까지 남은 시간(ms), 아니면 null.
            opensInMs: e.state === 'open' ? Math.max(0, e.openMs - (now - e.openedAt)) : null,
            lastCategory: e.lastCategory,
        }))
        .sort((a, b) => (a.state === b.state ? b.failuresInWindow - a.failuresInWindow : a.state === 'open' ? -1 : 1));
}

/** 수동 리셋 — 오탐 차단을 즉시 되돌릴 수단이 없으면 이 기능은 켤 수 없다. */
export function resetToolCircuit(tool: string): boolean {
    return entries.delete(tool);
}

/** 테스트 전용 — 모듈 레벨 상태 초기화. */
export function __resetCircuitsForTest(): void {
    entries.clear();
}
