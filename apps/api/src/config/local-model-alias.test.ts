/**
 * 로컬 모델 alias 해석 — DGX 모델 전환 뒤 옛 로컬 ID 가 정식 ID 로 해석되는지 (2026-10-30).
 * 카탈로그는 게이트웨이 발견 결과(selectLocalEntriesFromModelInfo)를 LLM_LOCAL_MODELS_JSON 으로 싣는다 —
 * getLocalModels 는 첫 호출 때 env 를 읽어 캐시하므로 첫 테스트 전에 env 를 둔다.
 */
jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { selectLocalEntriesFromModelInfo, type GatewayModelInfoEntry } from './local-models-discovery';
import { findLocalModel, getLocalModels } from './local-models';
import { resolveLocalModelId } from './local-model-alias';

const BASE = 'http://vllm-host:8002/v1';
// omk litellm_render_config 가 만드는 전환 뒤 모양 — 세 이름이 같은 upstream(openai/chat-next-32b).
const SWITCHED: GatewayModelInfoEntry[] = [
    { model_name: 'chat-next-32b', litellm_params: { model: 'openai/chat-next-32b', api_base: BASE }, model_info: {} },
    { model_name: 'qwen3.8-27b', litellm_params: { model: 'openai/chat-next-32b', api_base: BASE }, model_info: {} },
    { model_name: 'jev-decision', litellm_params: { model: 'openai/jev-decision', api_base: BASE }, model_info: {} },
    { model_name: 'gpt-3.5-turbo', litellm_params: { model: 'openai/chat-next-32b', api_base: BASE }, model_info: {} },
];
const catalog = selectLocalEntriesFromModelInfo(SWITCHED);
// 프로브가 정식 엔트리에 실측치를 채운 상태
catalog[0] = { ...catalog[0], contextLength: 131072, contextLengthProbed: true };
const savedJson = process.env.LLM_LOCAL_MODELS_JSON;
process.env.LLM_LOCAL_MODELS_JSON = JSON.stringify(catalog);
afterAll(() => {
    if (savedJson === undefined) delete process.env.LLM_LOCAL_MODELS_JSON; else process.env.LLM_LOCAL_MODELS_JSON = savedJson;
});

describe('resolveLocalModelId', () => {
    it('옛 이름·gpt-3.5-turbo 는 같은 upstream 의 정식 ID 로 해석한다', () => {
        expect(resolveLocalModelId('qwen3.8-27b')).toBe('chat-next-32b');
        expect(resolveLocalModelId('gpt-3.5-turbo')).toBe('chat-next-32b');
    });

    it('정식 ID·다른 그룹·미등록 ID·대소문자 다른 값은 그대로', () => {
        expect(resolveLocalModelId('chat-next-32b')).toBe('chat-next-32b');
        expect(resolveLocalModelId('jev-decision')).toBe('jev-decision');
        expect(resolveLocalModelId('unknown-model')).toBe('unknown-model');
        expect(resolveLocalModelId('QWEN3.8-27B')).toBe('QWEN3.8-27B');
    });

    it('두 엔트리가 같은 alias 를 가지면 해석하지 않는다', () => {
        const live = getLocalModels();
        live.push({ id: 'other-chat', displayName: 'other-chat', description: '', role: 'chat', aliases: ['gpt-3.5-turbo'] });
        try {
            expect(resolveLocalModelId('gpt-3.5-turbo')).toBe('gpt-3.5-turbo');
            expect(resolveLocalModelId('qwen3.8-27b')).toBe('chat-next-32b');
        } finally {
            live.pop();
        }
    });

    it('findLocalModel 은 옛 이름으로도 정식 엔트리(실측치 포함)를 돌려준다', () => {
        const e = findLocalModel('qwen3.8-27b');
        expect([e?.id, e?.contextLength, e?.contextLengthProbed]).toEqual(['chat-next-32b', 131072, true]);
        expect(findLocalModel('unknown-model')).toBeUndefined();
    });
});
