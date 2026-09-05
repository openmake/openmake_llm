/** user_memories 쿼리 — 사용자 격리(user_id 술어) + tombstone 조회 + soft delete. fake pool 로 SQL 검증. */
import type { Pool } from 'pg';
import { UserMemoryRepository } from './user-memory-repository';

function fakePool(rows: unknown[] = [], rowCount = 0) {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const pool = {
        query: jest.fn(async (sql: string, params?: unknown[]) => { calls.push({ sql, params }); return { rows, rowCount }; }),
    } as unknown as Pool;
    return { pool, calls };
}

describe('UserMemoryRepository — 사용자 격리', () => {
    it.each([
        ['listActiveByUser', (r: UserMemoryRepository) => r.listActiveByUser('u1')],
        ['listKnownContentsByUser', (r: UserMemoryRepository) => r.listKnownContentsByUser('u1')],
        ['countActiveByUser', (r: UserMemoryRepository) => r.countActiveByUser('u1')],
        ['softDeleteForUser', (r: UserMemoryRepository) => r.softDeleteForUser('m1', 'u1')],
        ['deleteAllForUser', (r: UserMemoryRepository) => r.deleteAllForUser('u1')],
    ])('%s 는 user_id 술어와 userId 파라미터를 가진다', async (_name, run) => {
        const { pool, calls } = fakePool([{ count: '0' }]);
        await run(new UserMemoryRepository(pool));
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/user_id\s*=\s*\$\d/);
        expect(calls[0].params).toContain('u1');
    });

    it('create 는 userId 를 INSERT 컬럼으로 넘긴다', async () => {
        const { pool, calls } = fakePool([{ id: 'm1', user_id: 'u1' }]);
        await new UserMemoryRepository(pool).create('m1', 'u1', 'hello');
        expect(calls[0].sql).toMatch(/INSERT INTO user_memories/);
        expect(calls[0].params).toEqual(['m1', 'u1', 'hello', 'explicit']);
    });
});

describe('UserMemoryRepository — tombstone / soft delete', () => {
    it('listKnownContentsByUser 는 is_active 필터가 없다 (삭제 행 포함)', async () => {
        const { pool, calls } = fakePool([{ content: 'a' }, { content: 'b' }]);
        const r = await new UserMemoryRepository(pool).listKnownContentsByUser('u1');
        expect(r).toEqual(['a', 'b']);
        expect(calls[0].sql).not.toMatch(/is_active/);
    });
    it('listActiveByUser 는 is_active = TRUE 만', async () => {
        const { pool, calls } = fakePool();
        await new UserMemoryRepository(pool).listActiveByUser('u1');
        expect(calls[0].sql).toMatch(/is_active\s*=\s*TRUE/);
    });
    it('softDeleteForUser 는 DELETE 가 아니라 is_active=FALSE UPDATE 이고, 타인 행은 0건', async () => {
        const { pool, calls } = fakePool([], 0);
        const ok = await new UserMemoryRepository(pool).softDeleteForUser('m1', 'other');
        expect(ok).toBe(false);
        expect(calls[0].sql).toMatch(/^\s*UPDATE user_memories SET is_active = FALSE/);
        expect(calls[0].sql).not.toMatch(/DELETE FROM/);
    });
});
