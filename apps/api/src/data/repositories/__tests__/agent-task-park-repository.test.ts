/**
 * 재시작으로 끊긴 로컬 기기 작업을 기기 대기로 주차 — 상태 전환과 주차 표식을 한 문장으로 남긴다
 * (표식 없는 paused 는 아무도 재개하지 않고 다음 부팅의 좀비 정리에 걸린다).
 */
import type { Pool } from 'pg';
import { AgentTaskParkRepository } from '../agent-task-park-repository';

function fakePool(results: Array<{ rows: unknown[]; rowCount?: number }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return results.shift() ?? { rows: [], rowCount: 0 }; }) };
    return { pool: pool as unknown as Pool, calls };
}

describe('AgentTaskParkRepository.parkForDeviceRecovery', () => {
    it('읽을 때의 상태 그대로인 중단 작업만 paused 로 바꾸고, 같은 문장에서 복구 이벤트와 기기 대기 표식을 남긴다', async () => {
        const { pool, calls } = fakePool([{ rows: [{ id: 1 }], rowCount: 1 }]);
        await expect(new AgentTaskParkRepository(pool).parkForDeviceRecovery('t1', 'failed')).resolves.toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toContain("SET status = 'paused'");
        expect(calls[0].sql).toContain('terminal_notify_pending = FALSE');
        expect(calls[0].sql).toContain('FOR UPDATE');
        expect(calls[0].sql).toContain('INSERT INTO agent_task_events');
        expect(calls[0].sql).not.toMatch(/checkpoint\s*=/);
        expect(calls[0].params).toEqual(['t1', 'failed', 'server restarted', 'boot recovery claim', 'device_wait']);
    });

    it('그 사이 다른 요청이 잡았으면(0행) false', async () => {
        const { pool } = fakePool([{ rows: [], rowCount: 0 }]);
        await expect(new AgentTaskParkRepository(pool).parkForDeviceRecovery('t1', 'running')).resolves.toBe(false);
    });
});
