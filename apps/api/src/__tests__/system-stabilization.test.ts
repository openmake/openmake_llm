import { LLM_TIMEOUTS } from '../config/timeouts';

describe('LLM_TIMEOUTS 상수 완전성', () => {
    it('MEMORY_EXTRACTION_TIMEOUT_MS 상수가 존재해야 한다', () => {
        expect(LLM_TIMEOUTS.MEMORY_EXTRACTION_TIMEOUT_MS).toBeDefined();
        expect(typeof LLM_TIMEOUTS.MEMORY_EXTRACTION_TIMEOUT_MS).toBe('number');
        expect(LLM_TIMEOUTS.MEMORY_EXTRACTION_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('CLASSIFIER_TIMEOUT_MS 상수가 존재해야 한다', () => {
        expect(LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS).toBeDefined();
        expect(typeof LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS).toBe('number');
        expect(LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS).toBeGreaterThan(0);
    });
});

// Phase B Phase 2-A (2026-05-26): SemanticClassificationCache 테스트 제거.
// LLM classifier 와 분류 캐시가 함께 삭제됨.

describe('CACHE_CONFIG 설정', () => {
    it('CACHE_CONFIG 상수가 존재해야 한다', () => {
        const { CACHE_CONFIG } = require('../config/runtime-limits');
        expect(CACHE_CONFIG).toBeDefined();
        expect(CACHE_CONFIG.QUERY_CACHE_TTL_MS).toBeDefined();
    });
});

describe('HistorySummarizer 실패 처리', () => {
    it('히스토리가 MIN_MESSAGES_TO_SUMMARIZE 미만이면 요약 없이 원본을 반환해야 한다', async () => {
        const { summarizeHistory } = require('../chat/history-summarizer');

        const shortHistory = [
            { role: 'user', content: '안녕하세요' },
            { role: 'assistant', content: '안녕하세요!' },
        ];

        const result = await summarizeHistory(shortHistory, 'llama3.2');
        expect(result.wasSummarized).toBe(false);
        expect(result.messages).toEqual(shortHistory);
        expect(result.originalCount).toBe(2);
        expect(result.summarizedCount).toBe(2);
    });

    it('LLM 호출 실패 시 원본 히스토리를 반환하고 예외를 전파하지 않아야 한다', async () => {
        // LLMClient 모듈을 모킹하여 LLM 호출 실패를 시뮬레이션
        jest.resetModules();
        jest.doMock('../llm', () => ({
            createClient: () => ({
                chat: jest.fn().mockRejectedValue(new Error('Connection refused: LLM 타임아웃 시뮬레이션')),
            }),
        }));

        const { summarizeHistory } = require('../chat/history-summarizer');

        // MIN_MESSAGES_TO_SUMMARIZE(10) 이상의 히스토리 생성
        const longHistory = Array.from({ length: 12 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `메시지 ${i + 1}`,
        }));

        // LLM 실패에도 불구하고 예외 없이 원본 반환
        const result = await summarizeHistory(longHistory, 'llama3.2');

        expect(result.wasSummarized).toBe(false);
        expect(result.messages).toEqual(longHistory);
        expect(result.originalCount).toBe(12);

        jest.resetModules();
    });

    it('LLM이 빈 요약을 반환하면 원본 히스토리를 반환해야 한다', async () => {
        jest.resetModules();
        jest.doMock('../llm', () => ({
            createClient: () => ({
                chat: jest.fn().mockResolvedValue({ content: '   ' }), // 공백만 반환
            }),
        }));

        const { summarizeHistory } = require('../chat/history-summarizer');

        const longHistory = Array.from({ length: 12 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `메시지 ${i + 1}`,
        }));

        const result = await summarizeHistory(longHistory, 'llama3.2');
        expect(result.wasSummarized).toBe(false);
        expect(result.messages).toEqual(longHistory);

        jest.resetModules();
    });
});
