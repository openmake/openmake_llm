/**
 * provider gate — 옛 로컬 ID 를 정식 ID 로 바꿔 돌려주는지 (2026-10-30 DGX 모델 전환).
 * 응답 배지(servedModelLabel)·대화기록·능력·프로필이 resolved.modelId 를 쓰므로 여기서 한 번 바꾼다.
 * 외부 provider 의 fullId 는 그대로여야 한다.
 */

jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../services/org/effective-policy', () => ({
    resolveEffectivePolicy: jest.fn(async () => ({ externalModel: { allow: [], deny: [] } })),
}));

import { runProviderGate, servedModelLabel } from '../services/chat-service/provider-gate';
import type { ProviderRouter, ResolvedProvider } from '../providers/provider-router';

const savedJson = process.env.LLM_LOCAL_MODELS_JSON;
process.env.LLM_LOCAL_MODELS_JSON = JSON.stringify([
    { id: 'chat-next-32b', displayName: 'chat-next-32b', description: '', role: 'chat', aliases: ['qwen3.8-27b', 'gpt-3.5-turbo'] },
]);
afterAll(() => {
    if (savedJson === undefined) delete process.env.LLM_LOCAL_MODELS_JSON; else process.env.LLM_LOCAL_MODELS_JSON = savedJson;
});

// ProviderRouter.resolve 와 같은 모양 — 검증 없이 fullId 를 나눠 돌려준다.
const router = {
    resolve: async (fullId: string): Promise<ResolvedProvider> => {
        const i = fullId.indexOf(':');
        return { provider: {} as ResolvedProvider['provider'], providerId: fullId.slice(0, i), modelId: fullId.slice(i + 1), fullId };
    },
} as unknown as ProviderRouter;
const ctx = { userId: 'u1' };

describe('runProviderGate — 로컬 alias 해석', () => {
    test('옛 로컬 ID(bare·local-llm:) → 정식 ID, 배지도 정식 ID', async () => {
        for (const requestedModel of ['qwen3.8-27b', 'local-llm:gpt-3.5-turbo']) {
            const r = await runProviderGate(router, { requestedModel, fallbackModel: 'chat-next-32b', ctx });
            expect([r.providerId, r.modelId, r.fullId, servedModelLabel(r)])
                .toEqual(['local-llm', 'chat-next-32b', 'local-llm:chat-next-32b', 'chat-next-32b']);
        }
    });

    test('정식·미등록 로컬 ID 와 외부 fullId 는 그대로', async () => {
        const local = await runProviderGate(router, { requestedModel: 'unknown-model', fallbackModel: 'chat-next-32b', ctx });
        expect([local.modelId, local.fullId]).toEqual(['unknown-model', 'local-llm:unknown-model']);
        const ext = await runProviderGate(router, { requestedModel: 'chatgpt:qwen3.8-27b', fallbackModel: 'chat-next-32b', ctx });
        expect([ext.providerId, ext.modelId, ext.fullId]).toEqual(['chatgpt', 'qwen3.8-27b', 'chatgpt:qwen3.8-27b']);
    });
});
