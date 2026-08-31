/**
 * Exact Tokenizer + 보정 계수 안전망 테스트.
 *
 * 배경(2026-08-31 실측): 문자 추정은 고엔트로피 입력에서 실제의 30~61% 로 과소추정해
 * 안전망을 그대로 통과시킨다. 임계 근처에서만 모델 토크나이저로 재계산하고, 그 비를
 * 절단 예산에 적용해 두 척도를 정합시킨다. 전 구간 fail-open.
 */
import type { ChatMessage } from '../llm/types';

const ORIGINAL_ENV = { ...process.env };

/** env 를 바꾼 뒤 config/llm 모듈을 새로 로드한다 (모듈 로드 시점에 env 를 읽으므로). */
function loadWithEnv(env: Record<string, string | undefined>) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, ...env };
    return {
        tokenizer: require('../llm/exact-tokenizer') as typeof import('../llm/exact-tokenizer'),
        pool: require('../llm/model-pool') as typeof import('../llm/model-pool'),
    };
}

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
    jest.restoreAllMocks();
});

describe('isExactTokenizeEnabled', () => {
    it('LLM_TOKENIZE_URL 미설정 → off (기존 동작 유지)', () => {
        const { tokenizer } = loadWithEnv({ LLM_TOKENIZE_URL: undefined });
        expect(tokenizer.isExactTokenizeEnabled()).toBe(false);
    });

    it('LLM_TOKENIZE_URL 설정 → on', () => {
        const { tokenizer } = loadWithEnv({ LLM_TOKENIZE_URL: 'http://vllm:8002/tokenize' });
        expect(tokenizer.isExactTokenizeEnabled()).toBe(true);
    });
});

describe('countExactTokens', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hello' }];

    it('off 상태면 호출 없이 null', async () => {
        const { tokenizer } = loadWithEnv({ LLM_TOKENIZE_URL: undefined });
        const spy = jest.spyOn(global, 'fetch' as never);
        expect(await tokenizer.countExactTokens(msgs, 'm')).toBeNull();
        expect(spy).not.toHaveBeenCalled();
    });

    it('count 를 그대로 반환하고 이미지 토큰을 가산', async () => {
        const { tokenizer } = loadWithEnv({
            LLM_TOKENIZE_URL: 'http://vllm:8002/tokenize',
            LLM_POOL_TOKENS_PER_IMAGE: '1500',
        });
        jest.spyOn(global, 'fetch' as never).mockResolvedValue({
            ok: true, json: async () => ({ count: 100 }),
        } as never);
        const withImage: ChatMessage[] = [{ role: 'user', content: 'hi', images: ['b64'] }];
        expect(await tokenizer.countExactTokens(withImage, 'm')).toBe(100 + 1500);
    });

    it('assistant.tool_calls 의 함수명·인자를 payload 에 포함 (도구 루프 과소추정 방지)', async () => {
        const { tokenizer } = loadWithEnv({ LLM_TOKENIZE_URL: 'http://vllm:8002/tokenize' });
        const spy = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
            ok: true, json: async () => ({ count: 10 }),
        } as never);
        await tokenizer.countExactTokens(
            [{
                role: 'assistant', content: '',
                tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'web_search', arguments: { q: 'x' } } }],
            }],
            'm',
        );
        const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.messages[0].content).toContain('web_search');
        expect(body.messages[0].content).toContain('{"q":"x"}');  // Record → JSON 직렬화
    });

    it.each([
        ['HTTP 실패', { ok: false, status: 500 }],
        ['count 필드 없음', { ok: true, json: async () => ({}) }],
    ])('%s → null (fail-open)', async (_label, response) => {
        const { tokenizer } = loadWithEnv({ LLM_TOKENIZE_URL: 'http://vllm:8002/tokenize' });
        jest.spyOn(global, 'fetch' as never).mockResolvedValue(response as never);
        expect(await tokenizer.countExactTokens(msgs, 'm')).toBeNull();
    });

    it('네트워크 예외 → null (fail-open)', async () => {
        const { tokenizer } = loadWithEnv({ LLM_TOKENIZE_URL: 'http://vllm:8002/tokenize' });
        jest.spyOn(global, 'fetch' as never).mockRejectedValue(new Error('ECONNREFUSED') as never);
        expect(await tokenizer.countExactTokens(msgs, 'm')).toBeNull();
    });
});

describe('selectModelByCapacityExact — 보정 계수', () => {
    /** 문자 추정 ~26K(임계 미달) / ~210K(임계 초과) 를 만드는 한국어 본문. */
    const small: ChatMessage[] = [{ role: 'user', content: '가'.repeat(25_000) }];
    /** 3개로 나눠 절단 여지를 둔다 (단일 메시지는 잘라낼 수 없어 overflow 가 정답). */
    const large: ChatMessage[] = Array.from({ length: 3 }, () => ({
        role: 'user' as const, content: '가'.repeat(70_000),
    }));

    it('임계 미달이면 tokenize 를 호출하지 않는다 (평상시 TTFT 무영향)', async () => {
        const { pool } = loadWithEnv({ LLM_TOKENIZE_URL: 'http://vllm:8002/tokenize' });
        const spy = jest.spyOn(global, 'fetch' as never);
        const d = await pool.selectModelByCapacityExact(small, { num_predict: 1000 });
        expect(spy).not.toHaveBeenCalled();
        expect(d.source).toBe('auto');
    });

    it('임계 초과 + 실제가 추정보다 크면 절단이 더 공격적으로 적용된다', async () => {
        const { pool } = loadWithEnv({ LLM_TOKENIZE_URL: 'http://vllm:8002/tokenize' });
        const rough = pool.estimateMessageTokens(large);
        // 실측 최악(base64/hex ≈ 추정의 3배) 재현
        jest.spyOn(global, 'fetch' as never).mockResolvedValue({
            ok: true, json: async () => ({ count: rough * 3 }),
        } as never);
        const d = await pool.selectModelByCapacityExact(large, { num_predict: 8192 });
        expect(d.source).toMatch(/auto_trimmed/);
        // 보정 없이 문자 추정만 쓰면 이 입력은 그대로 통과했다(= upstream 400).
        const uncalibrated = pool.selectModelByCapacity(large, { num_predict: 8192 });
        expect(uncalibrated.source).toBe('auto');
    });

    it('tokenize 실패 시 문자 추정 그대로 (fail-open — 종전 판정과 동일)', async () => {
        const { pool } = loadWithEnv({ LLM_TOKENIZE_URL: 'http://vllm:8002/tokenize' });
        jest.spyOn(global, 'fetch' as never).mockRejectedValue(new Error('timeout') as never);
        const d = await pool.selectModelByCapacityExact(large, { num_predict: 8192 });
        expect(d).toEqual(pool.selectModelByCapacity(large, { num_predict: 8192 }));
    });

    it('options.model 명시 → manual 우회 (tokenize 호출 없음)', async () => {
        const { pool } = loadWithEnv({ LLM_TOKENIZE_URL: 'http://vllm:8002/tokenize' });
        const spy = jest.spyOn(global, 'fetch' as never);
        const d = await pool.selectModelByCapacityExact(large, { model: 'x', num_predict: 100 });
        expect(d.source).toBe('manual');
        expect(spy).not.toHaveBeenCalled();
    });
});
