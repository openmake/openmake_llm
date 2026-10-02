/**
 * @module services/orchestrator/media-gate
 * @description 미디어 게이트(셰도우) — 의사결정 어댑터에 "이번 턴에 미디어 작업이 필요한가"를 묻고 결과를 기록용으로 돌려준다.
 *
 * ⚠️ 판단 경계: 앞단 LLM 판단(A형). 사용자 결정(2026-10-03)으로 **기록 전용**으로 도입한다 — Planner 는 종전대로 매 턴
 * 돌고, 이 판정은 `orchestrator_runs` 에 남을 뿐 동작을 바꾸지 않는다. Planner(중앙값 5초대)를 단순 턴에서 생략하는 데
 * 쓸 수 있는지는 Planner 결과와의 일치율(특히 미디어 요청을 놓친 건수)을 실측한 뒤 정한다.
 * 실패는 fail-open 이다(판정 없음으로 기록).
 */
import { DECISION, MEDIA_GATE } from '../../config/decision';
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
