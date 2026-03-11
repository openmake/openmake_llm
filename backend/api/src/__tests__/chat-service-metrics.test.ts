/**
 * chat-service-metrics 단위 테스트
 *
 * 테스트 범위:
 * - recordChatMetrics: 기본 사용량 추적 기록
 * - apiKeyId 존재 여부에 따른 recordTokenUsage 호출
 * - executionPlan isBrandModel 여부에 따른 profileId 전달
 * - MetricsCollector 호출 (incrementCounter, recordResponseTime, recordTokenUsage)
 * - AnalyticsSystem 호출 (recordAgentRequest, recordQuery)
 * - 내부 try/catch: MetricsCollector 실패 시 안전하게 계속 진행
 * - 내부 try/catch: AnalyticsSystem 실패 시 안전하게 계속 진행
 * - 외부 try/catch: 전체 실패 시 예외를 던지지 않음
 */

// ─────────────────────────────────────────────
// Mock 설정 (jest.mock 호이스팅 — 팩토리 내부에서만 jest.fn() 사용)
// ─────────────────────────────────────────────

const mockRecordRequest = jest.fn();
const mockGetCurrentKey = jest.fn();
const mockRecordTokenUsage = jest.fn();
const mockIncrementCounter = jest.fn();
const mockRecordResponseTime = jest.fn();
const mockMetricsRecordTokenUsage = jest.fn();
const mockRecordAgentRequest = jest.fn();
const mockRecordQuery = jest.fn();

jest.mock('../ollama/api-usage-tracker', () => ({
    getApiUsageTracker: jest.fn().mockReturnValue({
        recordRequest: jest.fn(),
    }),
}));

jest.mock('../ollama/api-key-manager', () => ({
    getApiKeyManager: jest.fn().mockReturnValue({
        getCurrentKey: jest.fn(),
    }),
}));

jest.mock('../middlewares/rate-limit-headers', () => ({
    recordTokenUsage: jest.fn(),
}));

jest.mock('../monitoring/metrics', () => ({
    getMetrics: jest.fn().mockReturnValue({
        incrementCounter: jest.fn(),
        recordResponseTime: jest.fn(),
        recordTokenUsage: jest.fn(),
    }),
}));

jest.mock('../monitoring/analytics', () => ({
    getAnalyticsSystem: jest.fn().mockReturnValue({
        recordAgentRequest: jest.fn(),
        recordQuery: jest.fn(),
    }),
}));

jest.mock('../utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { recordChatMetrics } from '../domains/chat/service/chat-service-metrics';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import { getApiKeyManager } from '../ollama/api-key-manager';
import { recordTokenUsage } from '../middlewares/rate-limit-headers';
import { getMetrics } from '../monitoring/metrics';
import { getAnalyticsSystem } from '../monitoring/analytics';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function makeParams(overrides: Partial<Parameters<typeof recordChatMetrics>[0]> = {}): Parameters<typeof recordChatMetrics>[0] {
    return {
        fullResponse: 'Hello, world!',
        startTime: Date.now() - 500,
        message: '안녕하세요',
        model: 'qwen3:latest',
        selectedAgent: { name: '기술 전문가' },
        agentSelection: { primaryAgent: 'coding' },
        ...overrides,
    };
}

// ─────────────────────────────────────────────
// beforeEach: 각 테스트 전 mock 재구성
// ─────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();

    (getApiUsageTracker as jest.Mock).mockReturnValue({ recordRequest: mockRecordRequest });
    (getApiKeyManager as jest.Mock).mockReturnValue({ getCurrentKey: mockGetCurrentKey });
    (recordTokenUsage as jest.Mock).mockImplementation(mockRecordTokenUsage);

    (getMetrics as jest.Mock).mockReturnValue({
        incrementCounter: mockIncrementCounter,
        recordResponseTime: mockRecordResponseTime,
        recordTokenUsage: mockMetricsRecordTokenUsage,
    });

    (getAnalyticsSystem as jest.Mock).mockReturnValue({
        recordAgentRequest: mockRecordAgentRequest,
        recordQuery: mockRecordQuery,
    });

    mockGetCurrentKey.mockReturnValue(null);
});

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

describe('recordChatMetrics', () => {

    describe('기본 동작', () => {
        test('예외를 던지지 않는다', () => {
            expect(() => recordChatMetrics(makeParams())).not.toThrow();
        });

        test('반환값이 undefined이다', () => {
            const result = recordChatMetrics(makeParams());
            expect(result).toBeUndefined();
        });

        test('usageTracker.recordRequest가 호출된다', () => {
            recordChatMetrics(makeParams());
            expect(mockRecordRequest).toHaveBeenCalledTimes(1);
        });

        test('recordRequest에 tokens(fullResponse.length)가 전달된다', () => {
            const fullResponse = 'Hello, world!'; // length=13
            recordChatMetrics(makeParams({ fullResponse }));
            expect(mockRecordRequest).toHaveBeenCalledWith(
                expect.objectContaining({ tokens: 13 })
            );
        });

        test('recordRequest에 model이 전달된다', () => {
            recordChatMetrics(makeParams({ model: 'gemini:flash' }));
            expect(mockRecordRequest).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'gemini:flash' })
            );
        });

        test('recordRequest에 responseTime이 숫자로 전달된다', () => {
            recordChatMetrics(makeParams());
            const callArg = mockRecordRequest.mock.calls[0][0];
            expect(typeof callArg.responseTime).toBe('number');
            expect(callArg.responseTime).toBeGreaterThanOrEqual(0);
        });
    });

    describe('apiKeyId 처리', () => {
        test('apiKeyId가 있으면 recordTokenUsage가 호출된다', () => {
            recordChatMetrics(makeParams({ apiKeyId: 'key-abc-123' }));
            expect(mockRecordTokenUsage).toHaveBeenCalledTimes(1);
            expect(mockRecordTokenUsage).toHaveBeenCalledWith('key-abc-123', expect.any(Number));
        });

        test('apiKeyId가 없으면 recordTokenUsage가 호출되지 않는다', () => {
            recordChatMetrics(makeParams({ apiKeyId: undefined }));
            expect(mockRecordTokenUsage).not.toHaveBeenCalled();
        });
    });

    describe('currentKey 처리', () => {
        test('currentKey가 있으면 recordRequest에 apiKeyId 앞 8자리가 전달된다', () => {
            mockGetCurrentKey.mockReturnValue('sk-abcdefghijklmn');
            recordChatMetrics(makeParams());
            expect(mockRecordRequest).toHaveBeenCalledWith(
                expect.objectContaining({ apiKeyId: 'sk-abcde' })
            );
        });

        test('currentKey가 null이면 recordRequest에 apiKeyId가 undefined로 전달된다', () => {
            mockGetCurrentKey.mockReturnValue(null);
            recordChatMetrics(makeParams());
            expect(mockRecordRequest).toHaveBeenCalledWith(
                expect.objectContaining({ apiKeyId: undefined })
            );
        });

        test('currentKey가 있으면 MetricsCollector api_key_usage 카운터가 증가한다', () => {
            mockGetCurrentKey.mockReturnValue('sk-abcdefghijklmn');
            recordChatMetrics(makeParams());
            expect(mockIncrementCounter).toHaveBeenCalledWith('api_key_usage', 1, { keyId: 'sk-abcde' });
        });

        test('currentKey가 null이면 api_key_usage 카운터가 증가하지 않는다', () => {
            mockGetCurrentKey.mockReturnValue(null);
            recordChatMetrics(makeParams());
            expect(mockIncrementCounter).not.toHaveBeenCalledWith('api_key_usage', expect.anything(), expect.anything());
        });
    });

    describe('executionPlan 처리', () => {
        test('executionPlan.isBrandModel=true이면 profileId가 requestedModel로 전달된다', () => {
            recordChatMetrics(makeParams({
                executionPlan: { isBrandModel: true, requestedModel: 'openmake_llm_pro' } as Parameters<typeof recordChatMetrics>[0]['executionPlan'],
            }));
            expect(mockRecordRequest).toHaveBeenCalledWith(
                expect.objectContaining({ profileId: 'openmake_llm_pro' })
            );
        });

        test('executionPlan.isBrandModel=false이면 profileId가 undefined로 전달된다', () => {
            recordChatMetrics(makeParams({
                executionPlan: { isBrandModel: false, requestedModel: 'openmake_llm_pro' } as Parameters<typeof recordChatMetrics>[0]['executionPlan'],
            }));
            expect(mockRecordRequest).toHaveBeenCalledWith(
                expect.objectContaining({ profileId: undefined })
            );
        });

        test('executionPlan이 없으면 profileId가 undefined로 전달된다', () => {
            recordChatMetrics(makeParams({ executionPlan: undefined }));
            expect(mockRecordRequest).toHaveBeenCalledWith(
                expect.objectContaining({ profileId: undefined })
            );
        });
    });

    describe('MetricsCollector 호출', () => {
        test('chat_requests_total 카운터가 model과 함께 증가한다', () => {
            recordChatMetrics(makeParams({ model: 'qwen3:latest' }));
            expect(mockIncrementCounter).toHaveBeenCalledWith('chat_requests_total', 1, { model: 'qwen3:latest' });
        });

        test('recordResponseTime이 호출된다', () => {
            recordChatMetrics(makeParams({ model: 'qwen3:latest' }));
            expect(mockRecordResponseTime).toHaveBeenCalledWith(expect.any(Number), 'qwen3:latest');
        });

        test('MetricsCollector recordTokenUsage가 호출된다', () => {
            recordChatMetrics(makeParams({ model: 'qwen3:latest', fullResponse: '12345' }));
            expect(mockMetricsRecordTokenUsage).toHaveBeenCalledWith(5, 'qwen3:latest');
        });

        test('MetricsCollector 실패해도 예외를 던지지 않는다', () => {
            (getMetrics as jest.Mock).mockReturnValue({
                incrementCounter: jest.fn().mockImplementation(() => { throw new Error('MetricsCollector error'); }),
                recordResponseTime: jest.fn(),
                recordTokenUsage: jest.fn(),
            });
            expect(() => recordChatMetrics(makeParams())).not.toThrow();
        });

        test('MetricsCollector 실패해도 AnalyticsSystem은 여전히 호출된다', () => {
            (getMetrics as jest.Mock).mockReturnValue({
                incrementCounter: jest.fn().mockImplementation(() => { throw new Error('MetricsCollector error'); }),
                recordResponseTime: jest.fn(),
                recordTokenUsage: jest.fn(),
            });
            recordChatMetrics(makeParams());
            expect(mockRecordAgentRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe('AnalyticsSystem 호출', () => {
        test('recordAgentRequest가 올바른 인자로 호출된다', () => {
            recordChatMetrics(makeParams({
                selectedAgent: { name: '코딩 전문가' },
                agentSelection: { primaryAgent: 'coding' },
            }));
            expect(mockRecordAgentRequest).toHaveBeenCalledWith(
                'coding',
                '코딩 전문가',
                expect.any(Number),
                true,
                expect.any(Number)
            );
        });

        test('agentSelection.primaryAgent가 없으면 agentId가 general로 전달된다', () => {
            recordChatMetrics(makeParams({
                agentSelection: { primaryAgent: '' },
            }));
            expect(mockRecordAgentRequest).toHaveBeenCalledWith(
                'general',
                expect.any(String),
                expect.any(Number),
                true,
                expect.any(Number)
            );
        });

        test('recordQuery가 사용자 메시지와 함께 호출된다', () => {
            recordChatMetrics(makeParams({ message: '테스트 쿼리입니다' }));
            expect(mockRecordQuery).toHaveBeenCalledWith('테스트 쿼리입니다');
        });

        test('AnalyticsSystem 실패해도 예외를 던지지 않는다', () => {
            (getAnalyticsSystem as jest.Mock).mockReturnValue({
                recordAgentRequest: jest.fn().mockImplementation(() => { throw new Error('Analytics error'); }),
                recordQuery: jest.fn(),
            });
            expect(() => recordChatMetrics(makeParams())).not.toThrow();
        });
    });

    describe('전체 실패 시 안전한 처리', () => {
        test('getApiUsageTracker가 던져도 예외를 던지지 않는다', () => {
            (getApiUsageTracker as jest.Mock).mockImplementation(() => { throw new Error('tracker init error'); });
            expect(() => recordChatMetrics(makeParams())).not.toThrow();
        });

        test('getApiKeyManager가 던져도 예외를 던지지 않는다', () => {
            (getApiKeyManager as jest.Mock).mockImplementation(() => { throw new Error('key manager error'); });
            expect(() => recordChatMetrics(makeParams())).not.toThrow();
        });
    });
});
