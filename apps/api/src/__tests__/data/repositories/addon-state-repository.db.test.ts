/**
 * AddonStateRepository SQL — 실제 Postgres 의미 검증(v1.85.0 핫픽스). 운영 표를 건드리지 않도록 한 연결 안의 TEMP 표에
 * 165·167 을 적용한다. 종전 setState 는 같은 파라미터를 컬럼 값과 비교식에 함께 써서 "inconsistent types deduced for
 * parameter $2" 로 **관리자 add-on 토글이 전부 실패**했다(mock 단위 테스트로는 보이지 않았다).
 * TEST_DATABASE_URL → DATABASE_URL, 둘 다 없으면 skip.
 */
import { Pool, type PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { AddonStateRepository } from '../../../data/repositories/addon-state-repository';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const MIG = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../../../../../db/migrations', f), 'utf8');

describeOrSkip('AddonStateRepository (TEMP addon_installations)', () => {
    let pool: Pool; let client: PoolClient; let repo: AddonStateRepository;
    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        // 165 의 표 정의만 TEMP 로(agent_skills 변경은 제외) → 167 적용
        const create = MIG('165_addon_installations.sql').split('-- 스킬의 소유 add-on')[0].replace('CREATE TABLE IF NOT EXISTS addon_installations', 'CREATE TEMP TABLE addon_installations').replace(/CREATE INDEX[^;]+;/g, '');
        await client.query(create);
        await client.query(MIG('167_addon_installations_desired_state.sql'));
        repo = new AddonStateRepository(client as unknown as Pool);
        await repo.upsertDiscovered({ addonId: 'x-runtime', name: 'x', version: '1.0.0', kind: 'runtime', source: 'builtin' });
    });
    afterAll(async () => { client?.release(true); await pool?.end(); });

    it('관리자 토글 disabled → enabled 가 된다(의도·revision 기록)', async () => {
        const off = await repo.setState('x-runtime', 'disabled', 'test');
        expect(off).toMatchObject({ state: 'disabled', desired_state: 'disabled', failure_reason: 'test' });
        const on = await repo.setState('x-runtime', 'enabled');
        expect(on).toMatchObject({ state: 'enabled', desired_state: 'enabled' });
        expect(on!.state_revision).toBeGreaterThan(off!.state_revision);
    });

    it('부팅 실패는 의도를 바꾸지 않고, 정상 부팅이 흔적을 지운다', async () => {
        await repo.markBootFailure('x-runtime', 'runtime_failed', 'boom');
        expect(await repo.get('x-runtime')).toMatchObject({ state: 'failed', desired_state: 'enabled', last_failure_code: 'runtime_failed' });
        await repo.markBootSucceeded('x-runtime');
        expect(await repo.get('x-runtime')).toMatchObject({ state: 'enabled', last_failure_code: null, failure_reason: null });
        const failed = await repo.setState('x-runtime', 'failed', 'manual');
        expect(failed).toMatchObject({ state: 'failed', desired_state: 'enabled' });
    });
});
