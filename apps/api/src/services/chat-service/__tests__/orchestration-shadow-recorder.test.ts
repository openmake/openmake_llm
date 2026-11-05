/**
 * 오케스트레이션 셰도우 적재 — 호환 기간(PR-H1-1)에는 add-on 도구 의도를 구 열(086)과 중립 열(196)에
 * 같은 값으로 이중 기록한다. 적재 실패는 경고만 남기고 채팅을 막지 않는다(fire-and-forget).
 */
const query = jest.fn();
let poolAvailable = true;
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => (poolAvailable ? { query } : null) }));
const warn = jest.fn();
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: (...a: unknown[]) => warn(...a), error: jest.fn() }),
}));

import { recordOrchestrationDispatch } from '../orchestration-shadow-recorder';

const flush = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };
const base = { requestId: 'r1', userId: 'u1', queryLength: 12, userMode: 'none', message: '질문' };

beforeEach(() => { jest.clearAllMocks(); poolAvailable = true; query.mockResolvedValue({ rows: [] }); });

describe('recordOrchestrationDispatch', () => {
    it.each([true, false])('add-on 도구 의도(%s)를 구 열과 중립 열에 같은 값으로 적재한다', async (intent) => {
        recordOrchestrationDispatch({ ...base, telemetry: { addonToolIntent: intent, taskDelegateIntent: false, exposed: [] } });
        await flush();
        expect(query).toHaveBeenCalledTimes(1);
        const [sql, params] = query.mock.calls[0] as [string, unknown[]];
        const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((c) => c.trim());
        const legacy = cols.indexOf('discussion_intent');
        const neutral = cols.indexOf('addon_tool_intent');
        expect(legacy).toBeGreaterThanOrEqual(0);
        expect(neutral).toBeGreaterThanOrEqual(0);
        expect(cols).toHaveLength(params.length);
        expect(params[legacy]).toBe(intent);
        expect(params[neutral]).toBe(intent);
    });

    it('적재 실패는 경고만 남기고 던지지 않는다', async () => {
        query.mockRejectedValueOnce(new Error('column "addon_tool_intent" does not exist'));
        expect(() => recordOrchestrationDispatch({ ...base, telemetry: { addonToolIntent: true, taskDelegateIntent: false, exposed: [] } })).not.toThrow();
        await flush();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('풀이 없으면 적재하지 않는다', async () => {
        poolAvailable = false;
        recordOrchestrationDispatch({ ...base, telemetry: { addonToolIntent: true, taskDelegateIntent: false, exposed: [] } });
        await flush();
        expect(query).not.toHaveBeenCalled();
    });
});
