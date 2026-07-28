import { parseModelParamsB, isRoleAssignableModel, ROLE_MODEL_MIN_PARAMS_B } from './role-model-filter';

describe('parseModelParamsB', () => {
    it('총 파라미터 우선 (35b-a3b → 35)', () => {
        expect(parseModelParamsB('qwen3.6-35b-a3b')).toBe(35);
        expect(parseModelParamsB('gemma-4-26b-a4b')).toBe(26);
    });
    it('다양한 표기', () => {
        expect(parseModelParamsB('nvidia/llama-3.1-nemotron-ultra-253b-v1')).toBe(253);
        expect(parseModelParamsB('meta-llama/llama-3.3-70b-instruct')).toBe(70);
        expect(parseModelParamsB('ministral-3:3b')).toBe(3);
        expect(parseModelParamsB('deepseek-v3.1:671b-cloud')).toBe(671);
        expect(parseModelParamsB('nvidia/llama-3.1-nemotron-nano-8b-v1')).toBe(8);
    });
    it('버전 번호는 파라미터로 오인 안 함', () => {
        expect(parseModelParamsB('z-ai/glm-5.2')).toBeNull();
        expect(parseModelParamsB('openai/gpt-5')).toBeNull();
        expect(parseModelParamsB('deepseek-v3.2')).toBeNull();
        expect(parseModelParamsB('glm-4.7')).toBeNull();
    });
});

describe('isRoleAssignableModel', () => {
    const m = (modelId: string, name = '') => ({ modelId, name });

    it('20B 초과 유지', () => {
        expect(isRoleAssignableModel(m('local-llm:qwen3.6-35b-a3b'))).toBe(true);
        expect(isRoleAssignableModel(m('nvidia:nvidia/llama-3.1-nemotron-ultra-253b-v1'))).toBe(true);
        expect(isRoleAssignableModel(m('openrouter:meta-llama/llama-3.3-70b-instruct'))).toBe(true);
    });

    it('20B 이하 제외', () => {
        expect(isRoleAssignableModel(m('ollama-cloud:ministral-3:3b'))).toBe(false);
        expect(isRoleAssignableModel(m('nvidia:nvidia/llama-3.1-nemotron-nano-8b-v1'))).toBe(false);
        expect(isRoleAssignableModel(m('openrouter:google/gemma-4-8b'))).toBe(false);
    });

    it('경계값: 정확히 20B 는 제외 (초과만 허용)', () => {
        expect(ROLE_MODEL_MIN_PARAMS_B).toBe(20);
        expect(isRoleAssignableModel(m('x:model-20b'))).toBe(false);
        expect(isRoleAssignableModel(m('x:model-21b'))).toBe(true);
    });

    it('파라미터 미표기(프론티어 모델) 유지', () => {
        expect(isRoleAssignableModel(m('openrouter:openai/gpt-5'))).toBe(true);
        expect(isRoleAssignableModel(m('nvidia:z-ai/glm-5.2'))).toBe(true);
        expect(isRoleAssignableModel(m('ollama-cloud:deepseek-v3.2'))).toBe(true);
    });

    it('채팅 불가(임베딩/이미지) 제외 — 크기 무관', () => {
        expect(isRoleAssignableModel(m('local-llm:bge-m3'))).toBe(false);
        expect(isRoleAssignableModel(m('local-llm:flux2-klein'))).toBe(false);
        expect(isRoleAssignableModel(m('nvidia:nvidia/nv-embed-v1'))).toBe(false);
        expect(isRoleAssignableModel(m('openrouter:some/whisper-large'))).toBe(false);
    });
});
