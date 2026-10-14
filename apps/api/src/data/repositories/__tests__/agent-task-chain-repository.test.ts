/**
 * 이어가기 선점(188) — 선점은 후속 행 INSERT **전에** 하는 조건부 UPDATE 다. 그래서 continued_by_task_id 에는
 * 즉시 검사 FK 를 걸 수 없다(걸면 실제 Postgres 에서 23503). pg-mem 이 devDependencies 에 없어 실 SQL 대신
 * 선점 SQL 의 모양과 마이그레이션 파일의 열 정의를 확인한다.
 */
import type { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AgentTaskChainRepository } from '../agent-task-chain-repository';

function fakePool(rowCount = 1) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount }; }) };
    return { pool: pool as unknown as Pool, calls };
}

const MIGRATIONS = join(__dirname, '../../../../../../db/migrations');
const MIGRATION = join(MIGRATIONS, '188_agent_task_chain.sql');

describe('AgentTaskChainRepository.claimContinuation — 선점 후 INSERT 순서', () => {
    it('선점은 아직 없는 후속 id 를 적는 조건부 UPDATE 하나다(후속 행을 만들지 않는다)', async () => {
        const { pool, calls } = fakePool(1);
        expect(await new AgentTaskChainRepository(pool).claimContinuation('t1', 'succ-not-inserted-yet')).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/^UPDATE agent_tasks SET continued_by_task_id = \$2 WHERE id = \$1 AND continued_by_task_id IS NULL$/);
        expect(calls[0].sql).not.toMatch(/INSERT/i);
        expect(calls[0].params).toEqual(['t1', 'succ-not-inserted-yet']);
    });
    it('다른 실행이 먼저 선점했으면 false', async () => {
        const { pool } = fakePool(0);
        expect(await new AgentTaskChainRepository(pool).claimContinuation('t1', 's')).toBe(false);
    });
});

describe('AgentTaskChainRepository.countChainSegments — 목록 카드의 세그먼트 수', () => {
    it('루트 id 들로 한 번에 센다(루트 포함, 목록 필터와 무관)', async () => {
        const calls: Array<{ sql: string; params: unknown[] }> = [];
        const pool = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [{ chain_root_task_id: 'r1', n: '4' }, { chain_root_task_id: 'r2', n: '1' }], rowCount: 2 }; }) } as unknown as Pool;
        const counts = await new AgentTaskChainRepository(pool).countChainSegments(['r1', 'r2']);
        expect(counts).toEqual(new Map([['r1', 4], ['r2', 1]]));
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/WHERE chain_root_task_id = ANY\(\$1::text\[\]\) GROUP BY 1/);
        expect(calls[0].params).toEqual([['r1', 'r2']]);
    });
    it('루트가 없으면 DB 를 부르지 않는다', async () => {
        const { pool, calls } = fakePool();
        expect(await new AgentTaskChainRepository(pool).countChainSegments([])).toEqual(new Map());
        expect(calls).toHaveLength(0);
    });
});

describe('마이그레이션 188 — continued_by_task_id 에 FK 가 없다', () => {
    const sql = readFileSync(MIGRATION, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    const columnDef = (name: string) => sql.split('\n').find((l) => l.includes(`ADD COLUMN IF NOT EXISTS ${name} `)) ?? '';
    it('continued_by_task_id 는 REFERENCES 없는 TEXT', () => {
        expect(columnDef('continued_by_task_id')).toMatch(/continued_by_task_id TEXT,/);
        expect(columnDef('continued_by_task_id')).not.toMatch(/REFERENCES/);
    });
    it('나머지 두 체인 열의 FK 는 그대로', () => {
        expect(columnDef('chain_root_task_id')).toMatch(/REFERENCES agent_tasks\(id\) ON DELETE SET NULL/);
        expect(columnDef('continued_from_task_id')).toMatch(/REFERENCES agent_tasks\(id\) ON DELETE SET NULL/);
    });
});

describe('마이그레이션 189 — 옛 188(FK 포함)이 먼저 적용된 DB 보정', () => {
    it('189 가 있고 continued_by FK 를 멱등으로 지운다', () => {
        const p = join(MIGRATIONS, '189_agent_task_chain_drop_continued_by_fk.sql');
        expect(existsSync(p)).toBe(true);
        expect(readFileSync(p, 'utf8')).toContain('DROP CONSTRAINT IF EXISTS agent_tasks_continued_by_task_id_fkey');
    });
    it('189 되돌리기는 FK 를 되살리지 않는다(주석만)', () => {
        const sql = readFileSync(join(MIGRATIONS, 'rollbacks/189_agent_task_chain_drop_continued_by_fk_rollback.sql'), 'utf8');
        expect(sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))).toEqual([]);
    });
});
