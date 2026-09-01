/**
 * buildExtraBody — 추론 강도가 모델별로 정규화되어 나가는지 고정.
 * (LLM_ENABLE_REASONING_EFFORT 가 켜졌을 때만 reasoning_effort 를 싣는 기존 계약도 함께 검증.)
 */
import { buildExtraBody } from './reasoning-adapter';

describe('buildExtraBody — reasoning_effort 정규화', () => {
    const saved = process.env.LLM_ENABLE_REASONING_EFFORT;
    // 운영 .env 의 모델별 지원 강도 override 가 정규화 기대값을 바꾼다
    // (실사례: qwen3.6 에 'high' 제외 → 'xhigh' 로 정규화되어 실패). 기본 맵으로 고정.
    const savedEffortsJson = process.env.LLM_REASONING_EFFORTS_JSON;
    beforeAll(() => {
        delete process.env.LLM_REASONING_EFFORTS_JSON;
    });
    afterAll(() => {
        if (saved !== undefined) process.env.LLM_ENABLE_REASONING_EFFORT = saved;
        else delete process.env.LLM_ENABLE_REASONING_EFFORT;
        if (savedEffortsJson !== undefined) process.env.LLM_REASONING_EFFORTS_JSON = savedEffortsJson;
        else delete process.env.LLM_REASONING_EFFORTS_JSON;
    });

    it('게이트가 꺼져 있으면 reasoning_effort 를 보내지 않는다 (기존 동작)', () => {
        process.env.LLM_ENABLE_REASONING_EFFORT = 'false';
        const body = buildExtraBody('high', 'qwen3.8-27b-awq');
        expect(body?.reasoning_effort).toBeUndefined();
        expect(body?.allowed_openai_params).toBeUndefined();
        expect(body?.chat_template_kwargs).toEqual({ enable_thinking: true });
    });

    it('reasoning_effort 를 보낼 땐 LiteLLM 통과 힌트를 동봉한다 (게이트웨이 400 회귀 차단)', () => {
        // 라이브 실측: 힌트 없이 보내면 LiteLLM 이 UnsupportedParamsError 400 으로 막는다.
        process.env.LLM_ENABLE_REASONING_EFFORT = 'true';
        const body = buildExtraBody('medium', 'qwen3.6-35b-a3b');
        expect(body?.reasoning_effort).toBe('medium');
        expect(body?.allowed_openai_params).toEqual(['reasoning_effort']);
    });

    it('게이트 ON: qwen3.8 의 high 는 xhigh 로 바꿔 보낸다 (400 회피)', () => {
        process.env.LLM_ENABLE_REASONING_EFFORT = 'true';
        expect(buildExtraBody('high', 'qwen3.8-27b-awq')?.reasoning_effort).toBe('xhigh');
        expect(buildExtraBody('low', 'qwen3.8-27b-awq')?.reasoning_effort).toBe('low');
    });

    it('게이트 ON: qwen3.6 은 요청값 그대로', () => {
        process.env.LLM_ENABLE_REASONING_EFFORT = 'true';
        expect(buildExtraBody('high', 'qwen3.6-35b-a3b')?.reasoning_effort).toBe('high');
        expect(buildExtraBody('medium', 'qwen3.6-35b-a3b')?.reasoning_effort).toBe('medium');
    });

    it('think=true(단계 미지정)는 high 의도로 해석 후 모델별 정규화', () => {
        process.env.LLM_ENABLE_REASONING_EFFORT = 'true';
        expect(buildExtraBody(true, 'qwen3.8-27b-awq')?.reasoning_effort).toBe('xhigh');
        expect(buildExtraBody(true, 'qwen3.6-35b-a3b')?.reasoning_effort).toBe('high');
    });

    it('think=false 는 강도를 싣지 않고 thinking 을 강제 OFF 한다', () => {
        process.env.LLM_ENABLE_REASONING_EFFORT = 'true';
        const body = buildExtraBody(false, 'qwen3.6-35b-a3b');
        expect(body?.reasoning_effort).toBeUndefined();
        expect(body?.chat_template_kwargs).toEqual({ enable_thinking: false });
    });
});
