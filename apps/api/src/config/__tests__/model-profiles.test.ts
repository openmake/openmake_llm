import { resolveModelProfile, resetModelProfileCache, licenseBlockReason } from '../model-profiles';
import { matchCapabilityPreset, resolveLocalCapabilities } from '../model-defaults';
import { supportedEfforts, normalizeEffort } from '../reasoning-effort';
import { applyLocalSamplingPreset } from '../../llm/sampling-preset';
import { applyLocalToolStrict } from '../../llm/tool-strict';
import type { ToolDefinition } from '../../llm/types';

const ENV_KEYS = ['LLM_MODEL_PROFILES_JSON', 'LLM_REASONING_EFFORTS_JSON', 'MODEL_NONCOMMERCIAL_ALLOWED'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } resetModelProfileCache(); });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } resetModelProfileCache(); });

const tool: ToolDefinition = { type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } } };

describe('모델 프로필 해석', () => {
    it('필드마다 그 필드를 가진 가장 긴 접두어가 이긴다', () => {
        const p = resolveModelProfile('qwen3.8-27b');
        expect(p.capabilities?.vision).toBe(true);
        expect(p.reasoningEfforts).toEqual(['low', 'medium', 'xhigh']);
        // 같은 계열의 다른 모델은 강도만 물려받고 능력은 미상으로 남는다(프로브·FALLBACK 으로 해석)
        expect(resolveModelProfile('qwen3.8-flash').capabilities).toBeUndefined();
        expect(resolveModelProfile('qwen3.8-flash').reasoningEfforts).toEqual(['low', 'medium', 'xhigh']);
    });

    it('로컬 키와 provider 한정 키는 서로 새어 나가지 않는다', () => {
        expect(resolveModelProfile('glm-5.3', 'bai').reasoningEfforts).toEqual(['low', 'high']);
        expect(resolveModelProfile('glm-5.3').reasoningEfforts).toBeUndefined();
        expect(supportedEfforts('qwen3.8-flash', 'bai')).toEqual(['low', 'medium', 'high']);
    });

    it('종전 해석기의 결과가 그대로다', () => {
        expect(matchCapabilityPreset('qwen3.8-27b')?.toolCalling).toBe(true);
        expect(matchCapabilityPreset('qwen3.6-anything')?.vision).toBe(false);
        expect(matchCapabilityPreset('unknown-model')).toBeNull();
        expect(normalizeEffort('qwen3.8-27b', 'high')).toBe('xhigh');
        expect(normalizeEffort('glm-5.3', 'medium', 'bai')).toBe('high');
    });
});

describe('프로필만으로 모델을 도입한다 (코드 수정 없음)', () => {
    beforeEach(() => {
        process.env.LLM_MODEL_PROFILES_JSON = JSON.stringify({
            'newmodel-9b': {
                capabilities: { toolCalling: true, thinking: false, vision: false, streaming: true },
                reasoningEfforts: ['low', 'high'],
                sampling: { instruct: { temperature: 0.3, top_p: 0.9 } },
                toolStrict: false,
                maxPromptImages: 0,
                license: { id: 'CC-BY-NC-4.0', commercialUse: false },
            },
        });
        resetModelProfileCache();
    });

    it('능력·강도·샘플링·strict 가 그 모델에만 적용된다', () => {
        expect(resolveLocalCapabilities('newmodel-9b-instruct')).toEqual({ toolCalling: true, thinking: false, vision: false, streaming: true });
        expect(normalizeEffort('newmodel-9b', 'medium')).toBe('high');
        const opts = applyLocalSamplingPreset(undefined, false, { modelId: 'newmodel-9b' });
        expect(opts?.temperature).toBe(0.3);
        expect(opts?.top_p).toBe(0.9);
        expect(opts?.presence_penalty).toBeDefined(); // 적지 않은 값은 전역 프리셋
        expect(applyLocalToolStrict([tool], { modelId: 'newmodel-9b' })?.[0].function.strict).toBeUndefined();
        expect(applyLocalToolStrict([tool], { modelId: 'qwen3.8-27b' })?.[0].function.strict).toBe(true);
    });

    it('env 는 기본 항목을 지우지 못하고, 형식이 틀린 필드만 버린다', () => {
        process.env.LLM_MODEL_PROFILES_JSON = JSON.stringify({ 'qwen3.8-27b': { reasoningEfforts: ['bogus'], maxPromptImages: 4 } });
        resetModelProfileCache();
        const p = resolveModelProfile('qwen3.8-27b');
        expect(p.reasoningEfforts).toEqual(['low', 'medium', 'xhigh']);
        expect(p.maxPromptImages).toBe(4);
        expect(resolveModelProfile('glm-5.3', 'bai').reasoningEfforts).toEqual(['low', 'high']);
    });

    it('구 env LLM_REASONING_EFFORTS_JSON 도 계속 읽는다', () => {
        process.env.LLM_REASONING_EFFORTS_JSON = JSON.stringify({ 'othermodel': ['low'] });
        resetModelProfileCache();
        expect(supportedEfforts('othermodel-7b')).toEqual(['low']);
    });

    it('비상업 라이선스 모델은 기본 차단, 평가용 배포만 env 로 연다', () => {
        expect(licenseBlockReason('newmodel-9b')).toContain('CC-BY-NC-4.0');
        expect(licenseBlockReason('qwen3.8-27b')).toBeNull();
        expect(licenseBlockReason('unknown-model')).toBeNull();
        process.env.MODEL_NONCOMMERCIAL_ALLOWED = 'true';
        expect(licenseBlockReason('newmodel-9b')).toBeNull();
    });
});
