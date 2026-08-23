/**
 * buildExtraBody — 추론 강도가 모델별로 정규화되어 나가는지 고정.
 * (LLM_ENABLE_REASONING_EFFORT 가 켜졌을 때만 reasoning_effort 를 싣는 기존 계약도 함께 검증.)
 */
import { buildExtraBody } from './reasoning-adapter';

describe('buildExtraBody — reasoning_effort 정규화', () => {
    const saved = process.env.LLM_ENABLE_REASONING_EFFORT;
    afterAll(() => {
        if (saved !== undefined) process.env.LLM_ENABLE_REASONING_EFFORT = saved;
        else delete process.env.LLM_ENABLE_REASONING_EFFORT;
    });

    it('게이트가 꺼져 있으면 reasoning_effort 를 보내지 않는다 (기존 동작)', () => {
        process.env.LLM_ENABLE_REASONING_EFFORT = 'false';
        const body = buildExtraBody('high', 'qwen3.8-27b-awq');
        expect(body?.reasoning_effort).toBeUndefined();
        expect(body?.chat_template_kwargs).toEqual({ enable_thinking: true });
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
