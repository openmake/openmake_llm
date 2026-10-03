/**
 * @module services/decision/jev-decision
 * @description 의사결정 어댑터 호출 — 예/아니오(noul) 판정 1건을 확률로 돌려준다.
 *
 * ⚠️ 판단 경계: 이 모듈은 호출 수단일 뿐이다. 앞단(A형)에 쓰려면 호출부가 사용자 결정·실측 근거를 주석에 남긴다.
 * 불변식: **fail-open** — 오류·시간 초과·형식 불일치는 throw 하지 않고 `pTrue: null` + 사유로 돌려준다.
 */
import { DECISION } from '../../config/decision';
import { getConfig } from '../../config/env';

export interface NoulDecision {
    /** true 일 확률(0~1). 판정하지 못했으면 null */
    pTrue: number | null;
    ms: number;
    error?: string;
}

interface DecideDeps {
    fetchFn?: typeof fetch;
    baseUrl?: string;
    apiKey?: string;
    signal?: AbortSignal;
}

/** 어댑터가 학습한 고정 형식 — 줄 구성을 바꾸면 확률이 틀어진다 */
export function buildNoulPrompt(state: string, question: string): string {
    return `[kind] noul\n[state] ${state}\n[question] ${question}\n[options]\nfalse\ntrue\n[decision]:`;
}

/** 선택지 토큰 logprob → true 확률. p = softmax((logprob + bias) / T). 한쪽이라도 없으면 null */
export function noulProbability(top: Record<string, number> | undefined): number | null {
    const lt = top?.true;
    const lf = top?.false;
    if (typeof lt !== 'number' || typeof lf !== 'number') return null;
    const { TRUE_BIAS, FALSE_BIAS, TEMPERATURE } = DECISION.NOUL;
    const zt = (lt + TRUE_BIAS) / TEMPERATURE;
    const zf = (lf + FALSE_BIAS) / TEMPERATURE;
    const m = Math.max(zt, zf);
    const et = Math.exp(zt - m);
    const ef = Math.exp(zf - m);
    return et / (et + ef);
}

export async function decideNoul(input: { state: string; question: string }, deps: DecideDeps = {}): Promise<NoulDecision> {
    const startedAt = Date.now();
    const fail = (error: string): NoulDecision => ({ pTrue: null, ms: Date.now() - startedAt, error });
    try {
        const cfg = deps.baseUrl === undefined || deps.apiKey === undefined ? getConfig() : undefined;
        const baseUrl = (deps.baseUrl ?? cfg?.llmBaseUrl ?? '').replace(/\/$/, '');
        const apiKey = deps.apiKey ?? cfg?.llmApiKey;
        const timeout = AbortSignal.timeout(DECISION.TIMEOUT_MS);
        const res = await (deps.fetchFn ?? fetch)(`${baseUrl}/v1/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
            // top_k 0 · top_p 1 · repetition_penalty 1 은 필수 — 서버 기본값이 logprob 을 자르거나 왜곡한다.
            body: JSON.stringify({
                model: DECISION.MODEL,
                prompt: buildNoulPrompt(input.state, input.question),
                max_tokens: 1, temperature: 1, top_k: 0, top_p: 1, repetition_penalty: 1,
                logprobs: 2,
                allowed_token_ids: [DECISION.NOUL.FALSE_TOKEN_ID, DECISION.NOUL.TRUE_TOKEN_ID],
            }),
            signal: deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout,
        });
        if (!res.ok) return fail(`HTTP ${res.status}`);
        const json = await res.json() as { choices?: Array<{ logprobs?: { top_logprobs?: Array<Record<string, number>> } }> };
        const pTrue = noulProbability(json.choices?.[0]?.logprobs?.top_logprobs?.[0]);
        if (pTrue === null) return fail('logprob 없음');
        return { pTrue, ms: Date.now() - startedAt };
    } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
    }
}
