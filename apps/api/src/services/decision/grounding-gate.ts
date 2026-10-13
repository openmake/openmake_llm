/**
 * @module services/decision/grounding-gate
 * @description 근거 게이트(기록 전용, 문장 단위) — 답에서 출처 번호를 인용한 문장마다, 그 문장이 인용한 출처에
 * 근거했는지를 의사결정 어댑터에 묻고 기록한다.
 *
 * ⚠️ 판단 경계: 후단 판정(C형)이다. 답을 저장한 **뒤에** 돌고, 답을 바꾸거나 막지 않는다(fail-open).
 * 사용자 결정(2026-10-13)으로 기록 전용에서 시작한다 — 기준값과 걸렸을 때의 처리는 `chat_grounding_gate_log` 실측으로 정한다.
 * 방식의 근거와 한계는 config/decision.ts 의 GROUNDING_GATE 주석에 있다.
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
    model: string;
    /** 확인한 인용 문장 수 — 0 이면 인용 문장이 없어 어댑터를 부르지 않았다 */
    claimCount: number;
    /** 문장별 확률 중 가장 낮은 값. 판정된 문장이 없으면 없음 */
    minP?: number;
    /** 기준(LOW_THRESHOLD) 미만으로 나온 문장 수 */
    lowCount: number;
    /** 어댑터 호출 시간 합(ms) */
    ms: number;
    /** 마지막 판정 실패 사유 */
    error?: string;
    /** 문장별 결과 — 그 문장의 값을 준 출처 번호와 확률(판정 실패면 null) */
    claims: Array<{ n: number; p: number | null }>;
}

export interface GroundingGateDeps {
    enabled?: boolean;
    modelAvailable?: () => boolean;
    decide?: (input: { state: string; question: string }) => Promise<NoulDecision>;
}

export interface CitedClaim {
    text: string;
    /** 문장이 인용한 출처 번호(중복 없음, 나온 순서) */
    ns: number[];
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
/** 본문의 출처 표기 — "[출처 12]"·"[12]" */
const CITATION = /\[(?:출처\s*)?(\d{1,3})\]/g;
/** 문장으로 보지 않는 줄 — 표·머리글·인용 블록·코드 울타리 */
const NON_PROSE_LINE = /^\s*(\||#|>|```)/;
/** 문장 경계 — 마침표류 뒤의 공백. 뒤따르는 출처 표기는 앞 문장에 붙여 둔다 */
const SENTENCE_BREAK = /(?<=[.!?。])\s+(?=[^[\s])/;
const EMPHASIS_MARKS = /[*_`]/g;

/** PURE: 답에서 출처 번호를 인용한 문장을 뽑는다. 문장에서 출처 표기와 강조 기호는 뺀다 */
export function citedClaims(answer: string): CitedClaim[] {
    const claims: CitedClaim[] = [];
    for (const line of answer.split(/\n+/)) {
        if (NON_PROSE_LINE.test(line)) continue;
        for (const sentence of line.split(SENTENCE_BREAK)) {
            const ns = [...new Set([...sentence.matchAll(CITATION)].map((m) => Number(m[1])))];
            if (ns.length === 0) continue;
            const text = oneLine(sentence.replace(CITATION, '').replace(EMPHASIS_MARKS, ''));
            if (text.length < GROUNDING_GATE.CLAIM_MIN_CHARS) continue;
            claims.push({ text: text.slice(0, GROUNDING_GATE.CLAIM_MAX_CHARS), ns });
        }
    }
    return claims;
}

/** PURE: 어댑터에 싣는 상태 — 출처 하나(제목·요약)와 문장 하나 */
export function buildClaimState(source: SearchSourceRef, claim: string): string {
    return `Source: "${oneLine(source.title)} — ${oneLine(source.snippet).slice(0, GROUNDING_GATE.SNIPPET_MAX_CHARS)}"\nClaim: "${claim}"`;
}

/**
 * @returns 기록할 판정. 출처가 없거나, 꺼져 있거나, 판정 모델이 없으면 undefined. 인용 문장이 없는 답은 어댑터를 부르지 않고
 * `claimCount: 0` 으로 돌려준다(인용 없는 답의 비율을 보기 위해 남긴다). 예외를 올리지 않는다.
 */
export async function runGroundingGate(
    input: { sources: SearchSourceRef[]; answer: string },
    deps: GroundingGateDeps = {},
): Promise<GroundingGateRecord | undefined> {
    if (!(deps.enabled ?? GROUNDING_GATE.SHADOW_ENABLED) || input.sources.length === 0) return undefined;
    const available = deps.modelAvailable ?? (() => !!findLocalModel(DECISION.MODEL));
    if (!available()) return undefined;
    const decide = deps.decide ?? ((i) => decideNoul(i));

    const byNumber = new Map(input.sources.map((s) => [s.n, s]));
    const targets = citedClaims(input.answer)
        .map((c) => ({ text: c.text, sources: c.ns.map((n) => byNumber.get(n)).filter((s): s is SearchSourceRef => !!s).slice(0, GROUNDING_GATE.MAX_SOURCES_PER_CLAIM) }))
        .filter((c) => c.sources.length > 0)
        .slice(0, GROUNDING_GATE.MAX_CLAIMS);

    const record: GroundingGateRecord = { model: DECISION.MODEL, claimCount: targets.length, lowCount: 0, ms: 0, claims: [] };
    // 한 번에 하나씩 묻는다 — 어댑터는 채팅 모델과 같은 엔진의 동시 처리 상한을 나눠 쓴다
    for (const target of targets) {
        let best: { n: number; p: number | null } = { n: target.sources[0].n, p: null };
        for (const source of target.sources) {
            const r = await decide({ state: buildClaimState(source, target.text), question: GROUNDING_GATE.QUESTION });
            record.ms += r.ms;
            if (r.error) record.error = r.error;
            // 여러 출처를 인용한 문장은 그중 하나만 받쳐 주면 된다 — 가장 높은 확률이 그 문장의 값
            if (r.pTrue !== null && (best.p === null || r.pTrue > best.p)) best = { n: source.n, p: r.pTrue };
        }
        record.claims.push(best);
        if (best.p === null) continue;
        if (best.p < GROUNDING_GATE.LOW_THRESHOLD) record.lowCount += 1;
        if (record.minP === undefined || best.p < record.minP) record.minP = best.p;
    }
    return record;
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
            pTrue: record.minP ?? null, gateError: record.error ?? null, gateMs: record.ms, gateModel: record.model,
            sourceCount: input.sources.length, answerChars: input.answer.length,
            method: 'claim', claimCount: record.claimCount, lowCount: record.lowCount, claims: record.claims,
        });
    } catch (e) {
        logger.debug(`근거 게이트 기록 실패 (무시): ${e instanceof Error ? e.message : String(e)}`);
    }
}
