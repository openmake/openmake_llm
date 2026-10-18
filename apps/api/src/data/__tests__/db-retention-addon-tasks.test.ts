/**
 * db-retention — add-on 소유 테이블의 보존 정리는 각 add-on 의 데이터 모듈이 선언한 작업으로 돈다.
 * 작업 하나의 실패는 그 작업만 건너뛰고, Base 의 다른 정리와 다른 add-on 작업은 계속된다.
 */
const mockQuery = jest.fn();
jest.mock('../models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({ query: mockQuery }) }),
    getPool: () => ({ query: mockQuery }),
}));
const ran: string[] = [];
const task = (name: string, result: number | Error) => ({
    name,
    run: async () => { ran.push(name); if (result instanceof Error) throw result; return result; },
});
jest.mock('../../addon-host/addon-data', () => ({
    getAddonDataModules: () => [
        { addonId: 'a', data: { retention: [task('a1', 3), task('a2', new Error('boom'))] }, error: null },
        { addonId: 'broken', data: null, error: 'Cannot find module' },
        { addonId: 'b', data: { retention: [task('b1', 0)] }, error: null },
    ],
}));

import { startDbRetention } from '../db-retention';

it('add-on 작업을 차례로 부르고, 실패한 작업은 건너뛴 채 나머지를 계속한다', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    const spy = jest.spyOn(global, 'setInterval');
    startDbRetention();
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
    for (const r of spy.mock.results) clearInterval(r.value as NodeJS.Timeout);
    spy.mockRestore();
    expect(ran).toEqual(['a1', 'a2', 'b1']);
    // Base 의 다른 정리(감사 로그 등)도 돌았다
    expect(mockQuery.mock.calls.some(([sql]) => /audit_logs/i.test(String(sql)))).toBe(true);
    // Base 는 add-on 테이블을 직접 지우지 않는다
    expect(mockQuery.mock.calls.some(([sql]) => /mcp_server_instances/i.test(String(sql)))).toBe(false);
});
