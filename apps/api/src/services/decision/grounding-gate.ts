/**
 * @module services/decision/grounding-gate
 * @description 근거 게이트(기록 전용) — 의사결정 어댑터에 "이 답이 그 턴의 검색 출처에 근거했는가"를 묻고 기록한다.
 *
 * ⚠️ 판단 경계: 후단 판정(C형)이다. 답을 저장한 **뒤에** 돌고, 답을 바꾸거나 막지 않는다(fail-open).
 * 사용자 결정(2026-10-13)으로 기록 전용에서 시작한다 — 기준값과 걸렸을 때의 처리는 `chat_grounding_gate_log` 실측으로 정한다.
 * 한계: 출처는 제목·요약만 본다(읽은 페이지 본문 전체가 아니다). 요약에 없는 사실을 맞게 쓴 답도 "근거 없음"으로 나올 수 있다.
 */
import { DECISION, GROUNDING_GATE } from '../../config/decision';
import { findLocalModel } from '../../config/local-models';
import { ChatGroundingGateLogRepository, type ChatGroundingGateLogEntry } from '../../data/repositories/chat-grounding-gate-log-repository';
import { getPool } from '../../data/models/unified-database';
import type { SearchSourceRef } from '../../tools/web-search/types';
import { createLogger } from '../../utils/logger';
import { decideNoul, type NoulDecision } from './jev-decision';

const logger = createLogger('GroundingGate');

export interface GroundingGateRecord {
    /** 답이 출처에 근거했을 확률. 판정 실패면 없음 */
    pTrue?: number;
    ms: number;
    error?: string;
    model: string;
}

export interface GroundingGateDeps {
    enabled?: boolean;
    modelAvailable?: () => boolean;
    decide?: (input: { state: string; question: string }) => Promise<NoulDecision>;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** PURE: 어댑터에 싣는 상태 — 출처(번호·제목·요약)와 답 앞부분을 각자의 상한에서 자른다 */
export function buildGroundingState(sources: SearchSourceRef[], answer: string): string {
    const listed = sources.map((s) => `[${s.n}] ${oneLine(s.title)} — ${oneLine(s.snippet)}`).join('\n').slice(0, GROUNDING_GATE.SOURCES_MAX_CHARS);
    return `Search results:\n${listed}\nAnswer: "${oneLine(answer).slice(0, GROUNDING_GATE.ANSWER_MAX_CHARS)}"`;
}

/** @returns 기록할 판정. 출처·답이 없거나, 꺼져 있거나, 판정 모델이 없으면 undefined(호출 없음). 예외를 올리지 않는다. */
export async function runGroundingGate(
    input: { sources: SearchSourceRef[]; answer: string },
    deps: GroundingGateDeps = {},
): Promise<GroundingGateRecord | undefined> {
    if (!(deps.enabled ?? GROUNDING_GATE.SHADOW_ENABLED)) return undefined;
    if (input.sources.length === 0 || !input.answer.trim()) return undefined;
    const available = deps.modelAvailable ?? (() => !!findLocalModel(DECISION.MODEL));
    if (!available()) return undefined;
    const decide = deps.decide ?? ((i) => decideNoul(i));
    const r = await decide({ state: buildGroundingState(input.sources, input.answer), question: GROUNDING_GATE.QUESTION });
    return { model: DECISION.MODEL, ...(r.pTrue !== null ? { pTrue: r.pTrue } : {}), ms: r.ms, ...(r.error ? { error: r.error } : {}) };
}

/** 저장 계층은 메시지 id 를 문자열로 돌려준다(DB 는 정수) — 정수로 읽히지 않으면 null */
function toMessageId(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}

/**
 * 답을 저장한 쪽이 기다리지 않고(void) 부른다 — 판정하고 한 행을 남긴다. 어떤 실패도 밖으로 나가지 않는다.
 */
export async function logGroundingShadow(
    input: { userId: string; sessionId: string; messageId?: string | number | null; sources: SearchSourceRef[]; answer: string },
    deps: { run?: typeof runGroundingGate; save?: (entry: ChatGroundingGateLogEntry) => Promise<void> } = {},
): Promise<void> {
    try {
        const record = await (deps.run ?? runGroundingGate)({ sources: input.sources, answer: input.answer });
        if (!record) return;
        const save = deps.save ?? ((entry: ChatGroundingGateLogEntry) => new ChatGroundingGateLogRepository(getPool()).insert(entry));
        await save({
            userId: input.userId, sessionId: input.sessionId, messageId: toMessageId(input.messageId),
            pTrue: record.pTrue ?? null, gateError: record.error ?? null, gateMs: record.ms, gateModel: record.model,
            sourceCount: input.sources.length, answerChars: input.answer.length,
        });
    } catch (e) {
        logger.debug(`근거 게이트 기록 실패 (무시): ${e instanceof Error ? e.message : String(e)}`);
    }
}
