/**
 * @module services/orchestrator/media-gate
 * @description 미디어 게이트(셰도우) — 의사결정 어댑터에 "이번 턴에 미디어 작업이 필요한가"를 묻고 결과를 기록용으로 돌려준다.
 *
 * ⚠️ 판단 경계: 앞단 LLM 판단(A형). 사용자 결정(2026-10-03)으로 **기록 전용**으로 도입한다 — Planner 는 종전대로 매 턴
 * 돌고, 이 판정은 `orchestrator_runs` 에 남을 뿐 동작을 바꾸지 않는다. Planner(중앙값 5초대)를 단순 턴에서 생략하는 데
 * 쓸 수 있는지는 Planner 결과와의 일치율(특히 미디어 요청을 놓친 건수)을 실측한 뒤 정한다.
 * 실패는 fail-open 이다(판정 없음으로 기록).
 */
import { DECISION, MEDIA_GATE, SEARCH_GATE } from '../../config/decision';
import { findLocalModel } from '../../config/local-models';
import { decideNoul, type NoulDecision } from '../decision/jev-decision';

export interface MediaGateRecord {
    gateModel: string;
    gatePTrue?: number;
    gateMs?: number;
    gateError?: string;
}

interface MediaGateDeps {
    modelAvailable?: () => boolean;
    decide?: (input: { state: string; question: string }, signal?: AbortSignal) => Promise<NoulDecision>;
}

export function buildMediaGateState(message: string, attachmentKinds: string[]): string {
    const text = message.replace(/\s+/g, ' ').trim().slice(0, DECISION.STATE_MAX_CHARS);
    return `User message: "${text}"\nAttachments: ${attachmentKinds.length ? attachmentKinds.join(', ') : 'none'}`;
}

/**
 * PURE: 이 판정으로 Planner 를 생략해도 되는가 — 켜져 있고, 첨부·진행 중 작업이 없고,
 * 미디어·검색 판정이 **둘 다** 있고 각자의 임계 미만일 때만. 하나라도 없으면(꺼짐·실패) Planner 로 보낸다.
 */
export function shouldSkipPlanner(gate: MediaGateRecord | undefined, searchGate: SearchGateRecord | undefined, attachmentCount: number): boolean {
    if (!MEDIA_GATE.SKIP_ENABLED || attachmentCount > 0) return false;
    if (gate?.gatePTrue === undefined || searchGate?.searchGatePTrue === undefined) return false;
    return gate.gatePTrue < MEDIA_GATE.SKIP_THRESHOLD && searchGate.searchGatePTrue < SEARCH_GATE.SKIP_THRESHOLD;
}

/** @returns 기록할 판정. 셰도우가 꺼져 있거나 결정 모델이 없으면 undefined(호출 없음) */
export async function runMediaGateShadow(
    input: { message: string; attachmentKinds: string[]; signal?: AbortSignal },
    deps: MediaGateDeps = {},
): Promise<MediaGateRecord | undefined> {
    if (!MEDIA_GATE.SHADOW_ENABLED) return undefined;
    const available = deps.modelAvailable ?? (() => !!findLocalModel(DECISION.MODEL));
    if (!available()) return undefined;
    const decide = deps.decide ?? ((i, signal) => decideNoul(i, { signal }));
    const r = await decide({ state: buildMediaGateState(input.message, input.attachmentKinds), question: MEDIA_GATE.QUESTION }, input.signal);
    return {
        gateModel: DECISION.MODEL,
        ...(r.pTrue !== null ? { gatePTrue: r.pTrue } : {}),
        gateMs: r.ms,
        ...(r.error ? { gateError: r.error } : {}),
    };
}

export interface SearchGateRecord {
    searchGatePTrue?: number;
    searchGateMs?: number;
    searchGateError?: string;
}

/**
 * 검색 게이트(기록 전용) — 같은 상태 문자열에 "웹 검색이 필요한가"를 묻는다. 판단 경계·근거는 config/decision.ts 의 SEARCH_GATE.
 * @returns 기록할 판정. 꺼져 있거나 결정 모델이 없으면 undefined(호출 없음)
 */
export async function runSearchGateShadow(
    input: { message: string; attachmentKinds: string[]; signal?: AbortSignal },
    deps: MediaGateDeps = {},
): Promise<SearchGateRecord | undefined> {
    if (!SEARCH_GATE.SHADOW_ENABLED) return undefined;
    const available = deps.modelAvailable ?? (() => !!findLocalModel(DECISION.MODEL));
    if (!available()) return undefined;
    const decide = deps.decide ?? ((i, signal) => decideNoul(i, { signal }));
    const r = await decide({ state: buildMediaGateState(input.message, input.attachmentKinds), question: SEARCH_GATE.QUESTION }, input.signal);
    return {
        ...(r.pTrue !== null ? { searchGatePTrue: r.pTrue } : {}),
        searchGateMs: r.ms,
        ...(r.error ? { searchGateError: r.error } : {}),
    };
}

/**
 * Planner 생략을 정하려고 두 판정을 기다리되 `ms` 까지만 — 하나라도 늦으면 둘 다 없음으로 돌려준다(→ Planner 로 간다).
 * 판정 자체는 계속 돌아 기록에는 남는다.
 */
export async function gatesWithin(
    gate: Promise<MediaGateRecord | undefined>,
    searchGate: Promise<SearchGateRecord | undefined>,
    ms: number,
): Promise<[MediaGateRecord | undefined, SearchGateRecord | undefined]> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<[undefined, undefined]>((resolve) => { timer = setTimeout(() => resolve([undefined, undefined]), ms); });
    try {
        return await Promise.race([Promise.all([gate, searchGate]), late]);
    } finally {
        clearTimeout(timer);
    }
}
