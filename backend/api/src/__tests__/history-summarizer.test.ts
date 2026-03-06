/**
 * History Summarizer 테스트
 */

// OllamaClient mock
jest.mock('../ollama/client', () => ({
    OllamaClient: jest.fn(),
    createClient: jest.fn(() => ({
        chat: jest.fn().mockResolvedValue({
            content: 'User asked about TypeScript generics and React hooks. Assistant explained with examples.',
        }),
    })),
}));

import { summarizeHistory } from '../chat/history-summarizer';
import { HISTORY_SUMMARIZER } from '../config/runtime-limits';
import { createClient } from '../ollama/client';

function makeHistory(count: number): Array<{ role: string; content: string; images?: string[] }> {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}: ${'x'.repeat(100)}`,
    }));
}

describe('summarizeHistory', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('히스토리가 임계값 미만이면 요약하지 않는다', async () => {
        const history = makeHistory(5);
        const result = await summarizeHistory(history, 'test-model');

        expect(result.wasSummarized).toBe(false);
        expect(result.messages).toBe(history);
        expect(result.originalCount).toBe(5);
        expect(createClient).not.toHaveBeenCalled();
    });

    it('히스토리가 임계값 이상이면 요약한다', async () => {
        const history = makeHistory(15);
        const result = await summarizeHistory(history, 'test-model');

        expect(result.wasSummarized).toBe(true);
        expect(result.originalCount).toBe(15);
        // 1(요약) + RECENT_MESSAGES_TO_KEEP
        expect(result.summarizedCount).toBe(1 + HISTORY_SUMMARIZER.RECENT_MESSAGES_TO_KEEP);
        expect(createClient).toHaveBeenCalledWith({
            model: 'test-model',
            timeout: HISTORY_SUMMARIZER.SUMMARY_TIMEOUT_MS,
        });
    });

    it('요약 결과에 최근 메시지가 원문 유지된다', async () => {
        const history = makeHistory(12);
        const keepCount = HISTORY_SUMMARIZER.RECENT_MESSAGES_TO_KEEP;
        const result = await summarizeHistory(history, 'test-model');

        // 첫 메시지는 요약 system 메시지
        expect(result.messages[0].role).toBe('system');
        expect(result.messages[0].content).toContain('[Previous conversation summary]');

        // 나머지는 원본 최근 메시지
        const recentOriginal = history.slice(-keepCount);
        for (let i = 0; i < keepCount; i++) {
            expect(result.messages[i + 1].content).toBe(recentOriginal[i].content);
        }
    });

    it('LLM 호출 실패 시 원본 히스토리를 반환한다', async () => {
        (createClient as jest.Mock).mockReturnValueOnce({
            chat: jest.fn().mockRejectedValue(new Error('LLM timeout')),
        });

        const history = makeHistory(15);
        const result = await summarizeHistory(history, 'test-model');

        expect(result.wasSummarized).toBe(false);
        expect(result.messages).toBe(history);
    });

    it('요약 결과가 너무 짧으면 원본을 유지한다', async () => {
        (createClient as jest.Mock).mockReturnValueOnce({
            chat: jest.fn().mockResolvedValue({ content: 'too short' }),
        });

        const history = makeHistory(15);
        const result = await summarizeHistory(history, 'test-model');

        expect(result.wasSummarized).toBe(false);
        expect(result.messages).toBe(history);
    });

    it('정확히 임계값일 때 요약을 트리거한다', async () => {
        const threshold = HISTORY_SUMMARIZER.MIN_MESSAGES_TO_SUMMARIZE;
        const history = makeHistory(threshold);
        const result = await summarizeHistory(history, 'test-model');

        expect(result.wasSummarized).toBe(true);
    });

    it('images 필드가 있는 메시지를 올바르게 처리한다', async () => {
        const history = makeHistory(12);
        history[0].images = ['base64data'];
        const result = await summarizeHistory(history, 'test-model');

        expect(result.wasSummarized).toBe(true);
    });
});
