/**
 * 통합 모델 배정 어댑터 실 DB 검증(K01 복제본 전용) — 운영(5432)에 절대 붙지 않는다. TEST_DATABASE_URL 없으면 skip.
 *
 * 검증:
 *  - ModelAssignmentsRepository round-trip
 *  - 합쳐진 슬롯(code): 기능 text.code 로 쓰면 역할 review 로 보이고, 역할로 쓰면 기능으로 보인다
 *  - 삭제는 두 뷰(역할·기능)를 모두 지운다
 *  - 순수 기능 슬롯은 역할 목록에 안 뜬다
 *  - 전역 scope('__global__') 어댑터 동작(원래 값 스냅샷 후 복원)
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ModelAssignmentsRepository } from '../model-assignments-repo';
import { CapabilityModelsRepository } from '../capability-models-repo';
import { UserModelRolesRepository } from '../user-model-roles-repo';
import { GlobalModelRolesRepository } from '../global-model-roles-repo';
import { GLOBAL_CAPABILITY_SCOPE } from '../../../config/capabilities';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN && !CONN.includes(':5432') ? describe : describe.skip;

describeOrSkip('model-assignments 어댑터 (실 DB)', () => {
    let pool: Pool;
    const scope = `test-ma-${randomUUID()}`;

    beforeAll(() => { pool = new Pool({ connectionString: CONN, max: 4 }); });
    afterAll(async () => {
        await pool.query('DELETE FROM model_assignments WHERE scope = $1', [scope]);
        await pool.end();
    });

    it('ModelAssignmentsRepository round-trip', async () => {
        const repo = new ModelAssignmentsRepository(pool);
        const { row, previous } = await repo.upsert(scope, 'agent', 'local-llm:m0', { temperature: '0.1' });
        expect(previous).toBeNull();
        expect(row).toMatchObject({ scope, slot: 'agent', fullId: 'local-llm:m0', params: { temperature: '0.1' } });
        expect(await repo.get(scope, 'agent')).toMatchObject({ fullId: 'local-llm:m0' });
        const upd = await repo.upsert(scope, 'agent', 'local-llm:m1', {});
        expect(upd.previous).toBe('local-llm:m0');
        expect((await repo.delete(scope, 'agent')).deleted).toBe(true);
        expect(await repo.get(scope, 'agent')).toBeNull();
    });

    it('합쳐진 슬롯 code: 기능↔역할 뷰가 같은 행을 본다', async () => {
        const cap = new CapabilityModelsRepository(pool);
        const roles = new UserModelRolesRepository(pool);

        // 기능 text.code 로 쓴다 → 역할 review 로 보인다
        await cap.upsert(scope, 'text.code', 'local-llm:code-a', { temperature: '0.3' });
        expect(await roles.getRoleModel(scope, 'review')).toBe('local-llm:code-a');
        expect(await cap.get(scope, 'text.code')).toMatchObject({ capability: 'text.code', fullId: 'local-llm:code-a', params: { temperature: '0.3' } });
        expect(await roles.listByUser(scope)).toContainEqual(expect.objectContaining({ role: 'review', fullModelId: 'local-llm:code-a' }));

        // 역할 review 로 덮어쓴다 → 기능 text.code 로 보인다(params 는 역할 쓰기라 초기화)
        await roles.upsert(scope, 'review', 'local-llm:code-b');
        expect(await cap.get(scope, 'text.code')).toMatchObject({ fullId: 'local-llm:code-b', params: {} });

        // 삭제는 두 뷰를 모두 지운다
        expect(await cap.delete(scope, 'text.code')).toBe(true);
        expect(await roles.getRoleModel(scope, 'review')).toBeNull();
        expect(await cap.get(scope, 'text.code')).toBeNull();
    });

    it('순수 기능 슬롯은 역할 목록에 안 뜬다', async () => {
        const cap = new CapabilityModelsRepository(pool);
        const roles = new UserModelRolesRepository(pool);
        await cap.upsert(scope, 'vision.describe', 'local-llm:vd', {});
        expect(await cap.listByScope(scope)).toContainEqual(expect.objectContaining({ capability: 'vision.describe' }));
        expect((await roles.listByUser(scope)).some((r) => r.fullModelId === 'local-llm:vd')).toBe(false);
        await cap.delete(scope, 'vision.describe');
    });

    it("전역 scope 어댑터 — research↔text.reason 뷰 공유 (원래 값 복원)", async () => {
        const gRepo = new GlobalModelRolesRepository(pool);
        const cap = new CapabilityModelsRepository(pool);
        // 원래 전역 reasoning 슬롯 스냅샷(복제본이라도 실데이터를 남기지 않는다)
        const before = await pool.query<{ full_id: string; params: unknown }>(
            'SELECT full_id, params FROM model_assignments WHERE scope = $1 AND slot = $2',
            [GLOBAL_CAPABILITY_SCOPE, 'reasoning'],
        );
        try {
            await gRepo.upsert('research', 'local-llm:global-reason');
            expect(await gRepo.list()).toContainEqual(expect.objectContaining({ role: 'research', fullModelId: 'local-llm:global-reason' }));
            expect(await cap.get(GLOBAL_CAPABILITY_SCOPE, 'text.reason')).toMatchObject({ fullId: 'local-llm:global-reason' });
        } finally {
            if (before.rows[0]) {
                await pool.query(
                    'UPDATE model_assignments SET full_id = $3, params = $4 WHERE scope = $1 AND slot = $2',
                    [GLOBAL_CAPABILITY_SCOPE, 'reasoning', before.rows[0].full_id, JSON.stringify(before.rows[0].params ?? {})],
                );
            } else {
                await pool.query('DELETE FROM model_assignments WHERE scope = $1 AND slot = $2', [GLOBAL_CAPABILITY_SCOPE, 'reasoning']);
            }
        }
    });
});
