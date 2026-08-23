/**
 * 로컬 모델 능력 해석 SoT — 프리셋 미등록 모델에서 도구가 조용히 꺼지던 문제 회귀.
 *
 * 과거 사고: `matchCapabilityPreset` 이 null 이면 FALLBACK(toolCalling=false)으로 떨어지고
 * external-tool-plan 이 도구 목록을 통째로 비워, 모델 교체 시 채팅 도구가 전면 불능이 됐다.
 * (model-defaults.ts 주석에 기록된 실제 사례.) 이제 부팅 프로브 실측이 그 공백을 메운다.
 */
import {
    FALLBACK_CAPABILITIES,
    resetCapabilityOverrideCache,
    resolveLocalCapabilities,
} from './model-defaults';

describe('resolveLocalCapabilities', () => {
    const saved = process.env.LLM_MODEL_CAPABILITIES_JSON;
    beforeEach(() => {
        delete process.env.LLM_MODEL_CAPABILITIES_JSON;
        resetCapabilityOverrideCache();
    });
    afterAll(() => {
        if (saved !== undefined) process.env.LLM_MODEL_CAPABILITIES_JSON = saved;
        else delete process.env.LLM_MODEL_CAPABILITIES_JSON;
        resetCapabilityOverrideCache();
    });

    it('프리셋이 있으면 그대로 쓴다 (기존 동작 보존)', () => {
        const caps = resolveLocalCapabilities('qwen3.6-35b-a3b');
        expect(caps).toMatchObject({ toolCalling: true, thinking: true, vision: true });
    });

    it('프리셋 미등록 + 프로브 없음 → 보수적 기본값 (기존과 동일)', () => {
        expect(resolveLocalCapabilities('llama-3.3-70b-instruct')).toEqual(FALLBACK_CAPABILITIES);
    });

    it('프리셋 미등록이어도 프로브가 도구 지원을 확인하면 도구를 켠다 (핵심 회귀)', () => {
        const caps = resolveLocalCapabilities('llama-3.3-70b-instruct', { toolCalling: true });
        expect(caps.toolCalling).toBe(true);
        // 실측하지 않은 축은 보수적으로 유지 — 잘못 켜면 upstream 400 이다.
        expect(caps.vision).toBe(false);
        expect(caps.thinking).toBe(false);
    });

    it('프로브가 미지원으로 판정하면 도구를 끈다', () => {
        expect(resolveLocalCapabilities('some-model', { toolCalling: false }).toolCalling).toBe(false);
    });

    it('프리셋이 있으면 프로브보다 우선한다 (실측 확정 지식 보존)', () => {
        expect(resolveLocalCapabilities('qwen3.6-35b-a3b', { toolCalling: false }).toolCalling).toBe(true);
    });

    it('env override 가 프리셋·프로브를 모두 이긴다', () => {
        process.env.LLM_MODEL_CAPABILITIES_JSON = JSON.stringify({
            'qwen3.6': { vision: false },
            'llama-4': { toolCalling: true, vision: true },
        });
        resetCapabilityOverrideCache();
        expect(resolveLocalCapabilities('qwen3.6-35b-a3b').vision).toBe(false);
        expect(resolveLocalCapabilities('qwen3.6-35b-a3b').toolCalling).toBe(true); // 미지정 축은 프리셋 유지
        expect(resolveLocalCapabilities('llama-4-scout', { toolCalling: false })).toMatchObject({
            toolCalling: true, vision: true,
        });
    });

    it('잘못된 env 는 무시하고 프리셋으로 진행한다 (부팅 실패 금지)', () => {
        process.env.LLM_MODEL_CAPABILITIES_JSON = '{"qwen3.6": {"toolCalling": "yes"}}';
        resetCapabilityOverrideCache();
        expect(resolveLocalCapabilities('qwen3.6-35b-a3b').toolCalling).toBe(true);
    });
});
