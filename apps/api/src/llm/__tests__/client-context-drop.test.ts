/**
 * 컨텍스트 절단을 호출자에게 알린다 — 창 초과로 요청 사본에서 오래된 메시지를 잘라냈으면 그 건수가 응답 지표에 실린다.
 * 종전에는 로그 한 줄뿐이라 에이전트 작업이 자기 대화가 잘린 줄 알 수 없었다.
 */
const selectModelByCapacityExact = jest.fn();
jest.mock('../model-pool', () => ({ selectModelByCapacityExact: (...a: unknown[]) => selectModelByCapacityExact(...a), estimateTokens: () => 1 }));
const nonStreamChat = jest.fn();
jest.mock('../stream-parser', () => ({ nonStreamChat: (...a: unknown[]) => nonStreamChat(...a), streamChat: jest.fn() }));
jest.mock('../user-quota', () => ({ reserveUserQuota: jest.fn(async () => null), settleUserQuota: jest.fn(async () => undefined) }));
jest.mock('../request-metrics', () => ({ recordLlmRequestMetric: jest.fn(), classifyLlmError: () => 'unknown' }));
jest.mock('../../services/cost/cost-ledger-service', () => ({ recordLlmCost: jest.fn() }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({ query: jest.fn(async () => ({ rows: [] })) }) }));

import { LLMClient } from '../client';
import { MODEL_POOL_CONFIG } from '../../config/model-pool';

const messages = [{ role: 'system' as const, content: 's' }, { role: 'user' as const, content: 'u' }];

describe('LLMClient.chat — 컨텍스트 절단 건수', () => {
    beforeEach(() => {
        nonStreamChat.mockReset().mockResolvedValue({ role: 'assistant', content: 'ok', metrics: { prompt_tokens: 3, completion_tokens: 1 } });
        selectModelByCapacityExact.mockReset();
    });

    it('오래된 메시지를 잘라냈으면 건수를 응답 지표에 싣는다', async () => {
        selectModelByCapacityExact.mockResolvedValue({ model: MODEL_POOL_CONFIG.defaultModel, source: 'auto_trimmed', adjustedMessages: [messages[0]], droppedMessages: 4 });
        const result = await new LLMClient({ model: MODEL_POOL_CONFIG.defaultModel }).chat(messages);
        expect(result.metrics?.context_dropped_messages).toBe(4);
        expect(result.metrics?.prompt_tokens).toBe(3);
    });

    it('잘라내지 않았으면 싣지 않는다', async () => {
        selectModelByCapacityExact.mockResolvedValue({ model: MODEL_POOL_CONFIG.defaultModel, source: 'auto' });
        const result = await new LLMClient({ model: MODEL_POOL_CONFIG.defaultModel }).chat(messages);
        expect(result.metrics?.context_dropped_messages).toBeUndefined();
    });
});
