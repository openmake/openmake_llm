/**
 * F25 잔여 저장소 SQL — 실제 Postgres 의미 검증. 사용자별 한도(213) upsert·CHECK·CASCADE, 조직·비용 grant 합계·멱등 삽입.
 * 한 연결의 트랜잭션 안에서만 쓰고 끝나면 ROLLBACK(마이그레이션이 적용된 DB 전제 — CI Gate 1.5).
 * TEST_DATABASE_URL 이 없으면 skip(운영 DB 를 가리키는 DATABASE_URL 로는 돌지 않는다).
 */
import { Pool, type PoolClient } from 'pg';
import { UserQuotaOverrideRepository } from '../../../data/repositories/user-quota-override-repository';
import { QuotaGrantRepository } from '../../../data/repositories/quota-grant-repository';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('F25 잔여 저장소 (트랜잭션 + ROLLBACK)', () => {
    let pool: Pool; let client: PoolClient;
    let overrides: UserQuotaOverrideRepository; let grants: QuotaGrantRepository;
    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query(`INSERT INTO users (id, username, password_hash) VALUES ('f25-u1','f25-u1','x'), ('f25-adm','f25-adm','x')`);
        await client.query(`INSERT INTO organizations (id, name, slug) VALUES ('f25-o1','f25','f25-o1')`);
        overrides = new UserQuotaOverrideRepository(client as unknown as Pool);
        grants = new QuotaGrantRepository(client as unknown as Pool);
    });
    afterAll(async () => { await client?.query('ROLLBACK').catch(() => undefined); client?.release(true); await pool?.end(); });

    it('사용자별 한도: upsert 는 덮어쓰고 NULL·0 을 구분해 보존한다', async () => {
        expect(await overrides.userExists('f25-u1')).toBe(true);
        expect(await overrides.userExists('f25-nobody')).toBe(false);
        await overrides.upsert('f25-u1', { hourlyTokenLimit: 5000, weeklyTokenLimit: null, monthlyCostBudgetMicros: 0, reason: 'a' }, 'f25-adm');
        const row = await overrides.upsert('f25-u1', { hourlyTokenLimit: 7000, weeklyTokenLimit: null, monthlyCostBudgetMicros: 0, reason: 'b' }, 'f25-adm');
        expect(row).toMatchObject({ user_id: 'f25-u1', weekly_token_limit: null, reason: 'b', updated_by: 'f25-adm' });
        expect(Number(row.hourly_token_limit)).toBe(7000);
        expect(Number(row.monthly_cost_budget_micros)).toBe(0);
        expect((await overrides.list(10)).find((r) => r.user_id === 'f25-u1')?.username).toBe('f25-u1');
    });

    it('사용자별 한도: 음수는 CHECK 로 거절', async () => {
        await client.query('SAVEPOINT neg');
        await expect(overrides.upsert('f25-u1', { hourlyTokenLimit: -1, weeklyTokenLimit: null, monthlyCostBudgetMicros: null, reason: null }, 'f25-adm')).rejects.toThrow();
        await client.query('ROLLBACK TO SAVEPOINT neg');
    });

    it('사용자 삭제 시 덮어쓰기 행도 사라진다(CASCADE), remove 는 없으면 false', async () => {
        await client.query(`DELETE FROM users WHERE id = 'f25-u1'`);
        expect(await overrides.get('f25-u1')).toBeNull();
        expect(await overrides.remove('f25-u1')).toBe(false);
    });

    it('조직·비용 grant: 주체·차원·버킷별 합계, 같은 source 는 한 번만', async () => {
        const base = { subjectType: 'org' as const, subjectId: 'f25-o1', dimension: 'tokens' as const, window: 'monthly' as const, bucket: '2026-11', kind: 'manual' as const };
        expect(await grants.insertGrantIfAbsent({ ...base, amount: 300, sourceId: 's1' })).toBe(true);
        expect(await grants.insertGrantIfAbsent({ ...base, amount: 300, sourceId: 's1' })).toBe(false);
        await grants.insertGrantIfAbsent({ ...base, amount: 200, sourceId: 's2' });
        await grants.insertGrantIfAbsent({ ...base, dimension: 'cost_micros', amount: 9, sourceId: 's3' });
        expect(await grants.sumGrants('org', 'f25-o1', 'tokens', 'monthly', '2026-11')).toBe(500);
        expect(await grants.sumGrants('org', 'f25-o1', 'cost_micros', 'monthly', '2026-11')).toBe(9);
        expect(await grants.sumGrants('org', 'f25-o1', 'tokens', 'monthly', '2026-12')).toBe(0);
        expect((await grants.listOrgGrants('f25-o1')).length).toBe(3);
    });
});
