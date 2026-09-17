const query = jest.fn(async () => ({ rows: [] }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({ query }) }));

import { classifyLlmError, recordLlmRequestMetric } from '../request-metrics';

const flush = () => new Promise((r) => setImmediate(r));

describe('llm request-metrics(158)', () => {
    beforeEach(() => query.mockClear());

    it('classifyLlmError — 원문 없이 짧은 코드', () => {
        expect(classifyLlmError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('aborted');
        expect(classifyLlmError(new Error('ABORTED'))).toBe('aborted');
        expect(classifyLlmError(new Error('Request timed out.'))).toBe('timeout');
        expect(classifyLlmError(Object.assign(new Error('bad'), { status: 429 }))).toBe('http_429');
        expect(classifyLlmError(Object.assign(new Error('secret sk-live-xyz leaked'), { code: 'FAST_FAIL_TIMEOUT_EXCEEDED' }))).toBe('fast_fail_timeout_exceeded');
        expect(classifyLlmError(undefined)).toBe('unknown');
    });

    it('기록 — 값 정규화(반올림·음수 방지·기본 클래스), 비동기 INSERT', async () => {
        recordLlmRequestMetric({ model: 'qwen3.8-27b', providerId: 'local-llm', ttftMs: 812.6, totalMs: -3, promptTokens: 10, completionTokens: 5, finishReason: 'stop', costOwner: 'local' });
        await flush();
        expect(query).toHaveBeenCalledTimes(1);
        const params = (query.mock.calls[0] as unknown as [string, unknown[]])[1];
        expect(params).toEqual(['qwen3.8-27b', 'local-llm', 'unspecified', null, 813, 0, 10, 5, 'stop', null, 'local']);
    });

    it('INSERT 실패는 삼킨다(fail-open)', async () => {
        query.mockRejectedValueOnce(new Error('relation does not exist'));
        expect(() => recordLlmRequestMetric({ model: 'm', providerId: 'p', totalMs: 1 })).not.toThrow();
        await flush();
    });
});
