/**
 * 사전 요약 캐시가 직전 턴 이미지를 떨어뜨리지 않는다(2026-11-08 멀티턴 vision).
 * 다음 턴은 (sessionId, history.length) 가 맞으면 클라이언트 history 대신 캐시본을 쓰므로, 새 user 항목에
 * 이미지가 없으면 직전 턴 이미지가 사라졌다. 요약기는 경계만 막고 받은 배열을 그대로 돌려준다.
 */
const mockSummarize = jest.fn();
const mockCacheSet = jest.fn();

jest.mock('../history-summarizer', () => ({ summarizeHistory: (...a: unknown[]) => mockSummarize(...a) }));
jest.mock('../../services/chat-service/history-summary-cache', () => ({
    historySummaryCache: { set: (...a: unknown[]) => mockCacheSet(...a) },
}));

import { scheduleHistoryPresummary } from '../history-presummary';
import { HISTORY_SUMMARIZER } from '../../config/runtime-limits';

type Msg = { role: string; content: string; images?: string[] };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const longHistory = (): Msg[] => Array.from({ length: HISTORY_SUMMARIZER.MIN_MESSAGES_TO_SUMMARIZE }, (_, i) => (
    { role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }
));
const img = 'data:image/png;base64,AAAA';

beforeEach(() => {
    mockSummarize.mockReset().mockImplementation(async (messages: Msg[]) => ({ wasSummarized: true, messages }));
    mockCacheSet.mockReset();
});

describe('scheduleHistoryPresummary — 현재 턴 이미지', () => {
    it('images 를 넘기면 새 user 항목에 images 가 있고 캐시에도 그 배열이 저장된다', async () => {
        const history = longHistory();
        scheduleHistoryPresummary(history, '이 그림은?', '고양이입니다', 'm', 's1', [img]);
        await flush();
        const sent = mockSummarize.mock.calls[0][0] as Msg[];
        expect(sent[history.length]).toEqual({ role: 'user', content: '이 그림은?', images: [img] });
        const [sid, len, cached] = mockCacheSet.mock.calls[0] as [string, number, Msg[]];
        expect([sid, len]).toEqual(['s1', history.length + 2]);
        expect(cached[history.length].images).toEqual([img]);
    });
    it('images 가 없거나 비면 새 user 항목에 images 키가 없다', async () => {
        scheduleHistoryPresummary(longHistory(), 'q', 'a', 'm', 's1');
        scheduleHistoryPresummary(longHistory(), 'q', 'a', 'm', 's2', []);
        await flush();
        for (const [messages] of mockSummarize.mock.calls as Array<[Msg[]]>) {
            expect(messages[messages.length - 2]).toEqual({ role: 'user', content: 'q' });
        }
        expect(mockSummarize).toHaveBeenCalledTimes(2);
    });
});
