import { buildReasoningEffortParams } from '../openai-compat-reasoning';

describe('buildReasoningEffortParams', () => {
    it('thinking 미지정/false 면 아무 파라미터도 싣지 않는다 (기존 요청과 동일)', () => {
        expect(buildReasoningEffortParams(undefined, 'glm-5.3-flash', 'bai', false)).toEqual({});
        expect(buildReasoningEffortParams(false, 'glm-5.3-flash', 'bai', false)).toEqual({});
    });

    it('직결 provider: reasoning_effort 만, 게이트웨이 힌트 없음', () => {
        expect(buildReasoningEffortParams('low', 'glm-5.3-flash', 'bai', false)).toEqual({ reasoning_effort: 'low' });
    });

    it('게이트웨이 경유: LiteLLM 통과용 allowed_openai_params 동반', () => {
        expect(buildReasoningEffortParams('high', 'gpt-oss-20b', 'hasa', true)).toEqual({
            reasoning_effort: 'high', allowed_openai_params: ['reasoning_effort'],
        });
    });

    it('레벨 미지정(true·budget 객체)은 medium 으로 해석', () => {
        expect(buildReasoningEffortParams(true, 'x', 'hasa', true).reasoning_effort).toBe('medium');
        expect(buildReasoningEffortParams({ budget: 1024 }, 'x', 'bai', false).reasoning_effort).toBe('medium');
    });

    it('외부 provider 의 같은 이름 모델에 로컬 xhigh 맵이 새지 않는다 — B.AI qwen3.8-flash high 는 high 그대로', () => {
        expect(buildReasoningEffortParams('high', 'qwen3.8-flash', 'bai', false).reasoning_effort).toBe('high');
    });
});
