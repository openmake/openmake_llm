/**
 * @module services/decision/task-gate
 * @description 작업 게이트 — 의사결정 어댑터에 "이 채팅 요청은 여러 단계의 작업이 필요한가"를 묻고 결과를 기록용으로 돌려준다.
 *
 * ⚠️ 판단 경계: 앞단 LLM 판단(A형)의 예외다. 사용자 결정(2026-10-13)으로 **기록 전용(shadow)에서 시작**한다.
 * 채팅 답과 나란히 돌아 본 호출을 막지 않고, 판정은 채팅의 경로·모델·도구 노출을 바꾸지 않는다 — 응답에 붙는 제안 정보일 뿐이다.
 * 유지·확대는 `chat_task_gate_log` 의 실측으로 정한다. 실패는 fail-open 이다(판정 없음으로 기록).
 */
import { DECISION, TASK_GATE, type TaskGateMode } from '../../config/decision';
import { findLocalModel } from '../../config/local-models';
import { decideNoul, type NoulDecision } from './jev-decision';

export interface TaskGateRecord {
    /** 'rule' = 명백한 단답이라 규칙으로 채팅 확정(어댑터 호출 없음), 'jev' = 어댑터 판정 */
    source: 'rule' | 'jev';
    /** 작업이 필요할 확률. rule 이면 0, 판정 실패면 없음 */
    pTrue?: number;
    ms: number;
    /** 판정 실패 사유(시간 초과·HTTP 오류·logprob 없음) */
    error?: string;
    model?: string;
}

export interface TaskGateDeps {
    mode?: TaskGateMode;
    modelAvailable?: () => boolean;
    decide?: (input: { state: string; question: string }, signal?: AbortSignal) => Promise<NoulDecision>;
}

/** 어댑터에 싣는 상태 문자열 — 미디어 게이트와 같은 형식(어댑터 학습 형식) */
export function buildTaskGateState(message: string, attachmentKinds: string[]): string {
    const text = message.replace(/\s+/g, ' ').trim().slice(0, DECISION.STATE_MAX_CHARS);
    return `User message: "${text}"\nAttachments: ${attachmentKinds.length ? attachmentKinds.join(', ') : 'none'}`;
}

/** @returns 기록할 판정. 꺼져 있거나 판정 모델이 없으면 undefined(호출 없음). 예외를 올리지 않는다(decideNoul 이 fail-open). */
export async function runTaskGate(
    input: { message: string; attachmentKinds: string[]; fastPathMatched: boolean; signal?: AbortSignal },
    deps: TaskGateDeps = {},
): Promise<TaskGateRecord | undefined> {
    if ((deps.mode ?? TASK_GATE.MODE) === 'off') return undefined;
    const available = deps.modelAvailable ?? (() => !!findLocalModel(DECISION.MODEL));
    if (!available()) return undefined;
    // 인사·감사 같은 명백한 단답은 묻지 않는다. 길이로는 거르지 않는다 — 짧은 지시("배포해줘")도 작업일 수 있다.
    if (input.fastPathMatched) return { source: 'rule', pTrue: 0, ms: 0 };
    const decide = deps.decide ?? ((i, signal) => decideNoul(i, { signal }));
    const r = await decide({ state: buildTaskGateState(input.message, input.attachmentKinds), question: TASK_GATE.QUESTION }, input.signal);
    return {
        source: 'jev',
        model: DECISION.MODEL,
        ...(r.pTrue !== null ? { pTrue: r.pTrue } : {}),
        ms: r.ms,
        ...(r.error ? { error: r.error } : {}),
    };
}

/** PURE: 이 판정을 응답에 실을 것인가 — 모드가 on 이고 어댑터 판정 확률이 기준 이상일 때만 */
export function shouldSuggestTask(
    record: TaskGateRecord | undefined,
    opts: { mode?: TaskGateMode; threshold?: number } = {},
): boolean {
    if ((opts.mode ?? TASK_GATE.MODE) !== 'on') return false;
    if (!record || record.source !== 'jev' || record.pTrue === undefined) return false;
    return record.pTrue >= (opts.threshold ?? TASK_GATE.THRESHOLD);
}
