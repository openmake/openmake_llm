/**
 * G3 절단 셰도우 레코더 단위 테스트 (2026-08-08)
 * 무DB 환경 pg hang 함정 방지 — getPool 은 mock (실 연결 금지).
 */
import { recordToolResultTruncation } from '../tool-result-truncation-recorder';

const queryMock = jest.fn().mockResolvedValue({ rowCount: 1 });
jest.mock('../../data/models/unified-database', () => ({
    getPool: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
}));

/** fire-and-forget 이 마이크로태스크로 실행되므로 큐 소진 후 단언 */
const flush = () => new Promise((r) => setImmediate(r));

describe('recordToolResultTruncation (G3)', () => {
    beforeEach(() => queryMock.mockClear());

    it('절단 발생 시 truncated=true 로 적재한다', async () => {
        recordToolResultTruncation({ path: 'chat', toolName: 'web_scrape', rawChars: 12000, capChars: 8000 });
        await flush();
        expect(queryMock).toHaveBeenCalledTimes(1);
        const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('INSERT INTO tool_result_truncations');
        expect(params).toEqual(['chat', 'web_scrape', 12000, 8000, true]);
    });

    it('캡 이내면 truncated=false 로 적재한다 (분모 확보)', async () => {
        recordToolResultTruncation({ path: 'agent_task', toolName: 'bash', rawChars: 500, capChars: 8000 });
        await flush();
        expect(queryMock.mock.calls[0][1]).toEqual(['agent_task', 'bash', 500, 8000, false]);
    });

    it('DB 오류는 흡수한다 (fail-open — 본 흐름 비차단)', async () => {
        queryMock.mockRejectedValueOnce(new Error('db down'));
        expect(() =>
            recordToolResultTruncation({ path: 'chat', toolName: 'x', rawChars: 1, capChars: 8000 }),
        ).not.toThrow();
        await flush();
    });
});
