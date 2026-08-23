/**
 * 추론 강도 정규화 — 모델별 지원값 차이 흡수 회귀.
 *
 * 배경(실측 2026-08-23, DGX 라이브): qwen3.8 은 reasoning_effort='high' 를 400 으로 거절한다
 * ("Supported types are xhigh (default), medium, and low"). 반면 qwen3.6 은 4값 모두 200.
 * UI 는 모델 불문 3단(낮음·보통·높음)을 노출하므로 서버 정규화가 없으면 모델 교체 시 요청이 죽는다.
 */
import {
    normalizeEffort,
    resetReasoningEffortCache,
    supportedEfforts,
    type ReasoningEffort,
} from './reasoning-effort';

describe('reasoning-effort 정규화', () => {
    const savedEnv = process.env.LLM_REASONING_EFFORTS_JSON;
    beforeEach(() => {
        delete process.env.LLM_REASONING_EFFORTS_JSON;
        resetReasoningEffortCache();
    });
    afterAll(() => {
        if (savedEnv !== undefined) process.env.LLM_REASONING_EFFORTS_JSON = savedEnv;
        else delete process.env.LLM_REASONING_EFFORTS_JSON;
        resetReasoningEffortCache();
    });

    it('qwen3.6 은 요청값을 그대로 쓴다 (4값 모두 지원)', () => {
        for (const e of ['low', 'medium', 'high', 'xhigh'] as ReasoningEffort[]) {
            expect(normalizeEffort('qwen3.6-35b-a3b', e)).toBe(e);
        }
    });

    it('qwen3.8 의 high 는 xhigh 로 승격된다 (거절값 회피 + 의도 보존)', () => {
        expect(supportedEfforts('qwen3.8-27b-awq')).not.toContain('high');
        expect(normalizeEffort('qwen3.8-27b-awq', 'high')).toBe('xhigh');
        expect(normalizeEffort('qwen3.8-27b-awq', 'low')).toBe('low');
        expect(normalizeEffort('qwen3.8-27b-awq', 'medium')).toBe('medium');
    });

    it('미등록 모델은 OpenAI 표준 3단으로 보수 처리 — xhigh 는 high 로 강등', () => {
        expect(supportedEfforts('llama-3.3-70b')).toEqual(['low', 'medium', 'high']);
        expect(normalizeEffort('llama-3.3-70b', 'xhigh')).toBe('high');
        expect(normalizeEffort(undefined, 'medium')).toBe('medium');
    });

    it('env override 로 새 모델을 배포 없이 등록할 수 있다', () => {
        process.env.LLM_REASONING_EFFORTS_JSON = JSON.stringify({ 'newmodel': ['low', 'xhigh'] });
        resetReasoningEffortCache();
        expect(supportedEfforts('newmodel-9b')).toEqual(['low', 'xhigh']);
        // medium(idx1) → low(d=1) vs xhigh(d=2) → 가까운 low
        expect(normalizeEffort('newmodel-9b', 'medium')).toBe('low');
    });

    it('잘못된 env 는 기본 카탈로그로 폴백한다 (부팅 실패 금지)', () => {
        process.env.LLM_REASONING_EFFORTS_JSON = '{"broken": ["ultra"]}';
        resetReasoningEffortCache();
        expect(supportedEfforts('qwen3.8-27b')).not.toContain('high');
    });
});
