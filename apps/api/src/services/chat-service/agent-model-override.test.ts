/**
 * agent-model-override — "자동" 판정 단일화(D3)와 에이전트 배정 모델 거절 시 폴백·고지(D4).
 */
const loadUserAgent = jest.fn();
const runProviderGate = jest.fn();
jest.mock('../../chat/execution-plan-builder', () => ({ getExecutionPlanBuilder: () => ({ loadUserAgent }) }));
jest.mock('./provider-gate', () => ({
    ...jest.requireActual('./provider-gate'),
    runProviderGate: (...a: unknown[]) => runProviderGate(...a),
}));

import { applyAgentModelOverride, isAutoModel, runGateWithAgentModel } from './agent-model-override';
import { ProviderError } from '../../providers/provider-errors';
import type { ProviderRouter } from '../../providers/provider-router';

const router = {} as ProviderRouter;
const LOCAL = { providerId: 'local-llm', modelId: 'local-default', fullId: 'local-llm:local-default' };
const EXT = { providerId: 'chatgpt', modelId: 'gpt-x', fullId: 'chatgpt:gpt-x' };

beforeEach(() => {
    loadUserAgent.mockReset().mockResolvedValue({ id: 'agent-1', name: 'A', model: 'chatgpt:gpt-x' });
    runProviderGate.mockReset();
});

describe('isAutoModel', () => {
    it.each([undefined, '', '  ', 'default'])('%p → 자동', (m) => expect(isAutoModel(m)).toBe(true));
    it.each(['local-llm:x', 'chatgpt:y'])('%p → 명시', (m) => expect(isAutoModel(m)).toBe(false));
});

describe('applyAgentModelOverride', () => {
    it('자동 + 모델 미배정 에이전트 → undefined (리터럴 default 가 새지 않는다)', async () => {
        loadUserAgent.mockResolvedValue({ id: 'agent-1', name: 'A', model: null });
        expect(await applyAgentModelOverride('default', 'agent-1', 'u1')).toEqual({ model: undefined, fromAgent: false });
    });

    it.each([
        ['userAgentId 없음', undefined, 'u1'],
        ['guest', 'agent-1', 'guest'],
    ])('자동 + %s → undefined, 에이전트 조회 없음', async (_l, agentId, userId) => {
        expect(await applyAgentModelOverride('default', agentId, userId)).toEqual({ model: undefined, fromAgent: false });
        expect(loadUserAgent).not.toHaveBeenCalled();
    });

    it('에이전트 조회 실패 → 자동으로 진행(silent)', async () => {
        loadUserAgent.mockRejectedValue(new Error('db down'));
        expect(await applyAgentModelOverride(undefined, 'agent-1', 'u1')).toEqual({ model: undefined, fromAgent: false });
    });
});

describe('runGateWithAgentModel', () => {
    const base = { userAgentId: 'agent-1', userId: 'u1', userRole: 'user', fallbackModel: 'local-default' } as const;

    it('배정 모델이 게이트에서 ProviderError → 자동으로 재해석하고 model_fallback 1회 고지', async () => {
        runProviderGate.mockRejectedValueOnce(new ProviderError('MISSING_API_KEY', 'no key')).mockResolvedValueOnce(LOCAL);
        const onSystemEvent = jest.fn();
        const r = await runGateWithAgentModel(router, { ...base, requestedModel: undefined, onSystemEvent });
        expect(r).toBe(LOCAL);
        expect(runProviderGate).toHaveBeenCalledTimes(2);
        expect(runProviderGate.mock.calls[0][1]).toMatchObject({ requestedModel: 'chatgpt:gpt-x', fallbackModel: 'local-default' });
        expect(runProviderGate.mock.calls[1][1]).toMatchObject({ requestedModel: undefined, fallbackModel: 'local-default' });
        expect(onSystemEvent).toHaveBeenCalledTimes(1);
        expect(onSystemEvent.mock.calls[0][0]).toMatchObject({
            type: 'model_fallback',
            metadata: { from: 'chatgpt:gpt-x', to: 'local-llm:local-default', code: 'MISSING_API_KEY' },
        });
    });

    it('배정 모델 통과 → 그대로, 고지 없음', async () => {
        runProviderGate.mockResolvedValueOnce(EXT);
        const onSystemEvent = jest.fn();
        expect(await runGateWithAgentModel(router, { ...base, requestedModel: 'default', onSystemEvent })).toBe(EXT);
        expect(onSystemEvent).not.toHaveBeenCalled();
    });

    it('고지 채널(onSystemEvent)이 없으면(HTTP) 폴백하지 않고 그대로 throw', async () => {
        runProviderGate.mockRejectedValueOnce(new ProviderError('MISSING_API_KEY', 'no key'));
        await expect(runGateWithAgentModel(router, { ...base, requestedModel: undefined })).rejects.toThrow(ProviderError);
        expect(runProviderGate).toHaveBeenCalledTimes(1);
    });

    it('명시 모델의 거절은 그대로 throw, 고지 없음', async () => {
        runProviderGate.mockRejectedValueOnce(new ProviderError('MISSING_API_KEY', 'no key'));
        const onSystemEvent = jest.fn();
        await expect(runGateWithAgentModel(router, { ...base, requestedModel: 'gemini:g-1', onSystemEvent })).rejects.toThrow(ProviderError);
        expect(runProviderGate).toHaveBeenCalledTimes(1);
        expect(onSystemEvent).not.toHaveBeenCalled();
    });

    it('배정 모델에서 ProviderError 가 아닌 예외는 그대로 throw', async () => {
        runProviderGate.mockRejectedValueOnce(new Error('boom'));
        const onSystemEvent = jest.fn();
        await expect(runGateWithAgentModel(router, { ...base, requestedModel: undefined, onSystemEvent })).rejects.toThrow('boom');
        expect(runProviderGate).toHaveBeenCalledTimes(1);
        expect(onSystemEvent).not.toHaveBeenCalled();
    });
});
