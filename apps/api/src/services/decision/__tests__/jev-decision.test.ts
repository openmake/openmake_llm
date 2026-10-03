/** jev-decision — 프롬프트 형식·확률 변환·호출 파라미터·fail-open 고정 (실제 모델 호출 없음) */
import { buildNoulPrompt, noulProbability, decideNoul } from '../jev-decision';
import { DECISION } from '../../../config/decision';

const okResponse = (top: Record<string, number>) => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ text: 'true', logprobs: { top_logprobs: [top] } }] }),
}) as unknown as Response;

describe('buildNoulPrompt', () => {
    it('어댑터가 학습한 고정 형식 그대로 만든다', () => {
        expect(buildNoulPrompt('User message: "hi"', 'Is it a greeting?')).toBe(
            '[kind] noul\n[state] User message: "hi"\n[question] Is it a greeting?\n[options]\nfalse\ntrue\n[decision]:',
        );
    });
});

describe('noulProbability', () => {
    it('두 선택지의 logprob 을 true 확률로 바꾼다', () => {
        const p = noulProbability({ true: Math.log(0.9), false: Math.log(0.1) });
        expect(p).not.toBeNull();
        expect(p as number).toBeGreaterThan(0.89);
        expect(p as number).toBeLessThan(0.91);
    });

    it('한쪽 토큰이 빠져 있으면 판정하지 않는다(null) — 지어내지 않는다', () => {
        expect(noulProbability({ true: -0.1 })).toBeNull();
        expect(noulProbability(undefined)).toBeNull();
    });
});

describe('decideNoul', () => {
    it('logprob 을 왜곡하지 않는 필수 파라미터로 /v1/completions 를 부른다', async () => {
        let url = ''; let body: Record<string, unknown> = {}; let auth = '';
        const fetchFn = (async (u: string, init: RequestInit) => {
            url = u; body = JSON.parse(String(init.body)); auth = (init.headers as Record<string, string>).Authorization;
            return okResponse({ true: -0.05, false: -3 });
        }) as unknown as typeof fetch;
        const r = await decideNoul({ state: 's', question: 'q' }, { fetchFn, baseUrl: 'http://gw:1/', apiKey: 'k' });
        expect(url).toBe('http://gw:1/v1/completions');
        expect(auth).toBe('Bearer k');
        expect(body).toMatchObject({
            model: DECISION.MODEL, max_tokens: 1, temperature: 1, top_k: 0, top_p: 1, repetition_penalty: 1,
            logprobs: 2, allowed_token_ids: [DECISION.NOUL.FALSE_TOKEN_ID, DECISION.NOUL.TRUE_TOKEN_ID],
        });
        expect(r.pTrue as number).toBeGreaterThan(0.9);
        expect(r.error).toBeUndefined();
    });

    it('HTTP 오류는 throw 하지 않고 사유만 돌려준다(fail-open)', async () => {
        const fetchFn = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
        const r = await decideNoul({ state: 's', question: 'q' }, { fetchFn, baseUrl: 'http://gw:1', apiKey: 'k' });
        expect(r.pTrue).toBeNull();
        expect(r.error).toContain('503');
    });

    it('네트워크 예외도 throw 하지 않는다(fail-open)', async () => {
        const fetchFn = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
        const r = await decideNoul({ state: 's', question: 'q' }, { fetchFn, baseUrl: 'http://gw:1', apiKey: 'k' });
        expect(r.pTrue).toBeNull();
        expect(r.error).toContain('ECONNREFUSED');
    });

    it('logprob 이 없는 응답은 판정 없음으로 처리한다', async () => {
        const fetchFn = (async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ text: 'x' }] }) })) as unknown as typeof fetch;
        const r = await decideNoul({ state: 's', question: 'q' }, { fetchFn, baseUrl: 'http://gw:1', apiKey: 'k' });
        expect(r.pTrue).toBeNull();
        expect(r.error).toBeDefined();
    });
});
