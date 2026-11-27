/**
 * 조직 확장 배포 모드 저장소(208·209) — 실제 Postgres SQL 의미 검증. TEST_DATABASE_URL 이 없으면 skip.
 *  ① 그룹 멤버는 조직 멤버만(복합 FK), 조직 탈퇴 시 그룹 멤버십 CASCADE
 *  ② 해석 재료 — 그 멤버가 속한 그룹의 덮어쓰기만, 다른 조직·공개 해제 항목 제외
 *  ③ claim 동시성 — 동시에 잡아도 한 쪽만 행을 받는다, 끝난 설치는 다시 잡지 않는다
 *  ④ user_removed — default_on 은 다시 잡지 않고 required 는 잡는다 · failed 재시도 상한·관리자 재저장 시 즉시 재시도
 *  ⑤ 주기 조정 대상 — 활성 조직이 그 조직이고 자동 설치 값이 있는 멤버만
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { ExtensionOrgDeploymentRepository } from '../../../data/repositories/extension-org-deployment-repository';
import { resolveDeploymentMode } from '../../../config/extension-org-deployment';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

const T = { failedRetryMs: 60 * 60 * 1000, maxAttempts: 3, installingStaleMs: 30 * 60 * 1000 };

describeOrSkip('ExtensionOrgDeploymentRepository (208·209)', () => {
    let pool: Pool;
    let repo: ExtensionOrgDeploymentRepository;
    const tag = randomUUID().slice(0, 8);
    const id = (s: string) => `${s}-${tag}`;
    const U = { pub: id('u-pub'), m1: id('u-m1'), m2: id('u-m2'), out: id('u-out') };
    const O1 = id('o1');
    const O2 = id('o2');

    async function ext(extId: string, owner: string, visibility: string, orgId: string | null) {
        await pool.query(
            `INSERT INTO user_extensions (id, user_id, name, version, source_url, source_ref, source_path, source_hash, manifest, visibility, org_id)
             VALUES ($1, $2, $1, '1.0.0', 'https://github.com/o/x', 'sha', 'plugin.json', 'h', '{}'::jsonb, $3, $4)`,
            [extId, owner, visibility, orgId]);
    }

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        repo = new ExtensionOrgDeploymentRepository(pool);
        for (const u of Object.values(U)) {
            await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [u]);
        }
        await pool.query(`UPDATE users SET preferences = jsonb_build_object('activeOrgId', $2::text) WHERE id = ANY($1::text[])`, [[U.m1, U.m2, U.pub], O1]);
        await pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1), ($2, $2, $2)`, [O1, O2]);
        await pool.query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member'), ($5, $3, 'member'), ($5, $6, 'member')`,
            [O1, U.pub, U.m1, U.m2, O2, U.out]);
        await ext(id('e-on'), U.pub, 'organization', O1);
        await ext(id('e-req'), U.pub, 'organization', O1);
        await ext(id('e-o2'), U.pub, 'organization', O2);
        await ext(id('e-priv'), U.pub, 'private', null);
    });

    afterAll(async () => {
        if (!pool) return;
        await pool.query(`DELETE FROM user_extensions WHERE id LIKE $1`, [`%-${tag}%`]);
        await pool.query(`DELETE FROM organizations WHERE id = ANY($1::text[])`, [[O1, O2]]);
        await pool.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [Object.values(U)]);
        await pool.end();
    });

    it('① 그룹 멤버는 조직 멤버만 — 비멤버는 FK 23503, 조직 탈퇴 시 그룹 멤버십 CASCADE', async () => {
        const g = await repo.createGroup(id('g-dev'), O1, 'dev', U.pub);
        await repo.addGroupMember(O1, g.id, U.m1);
        await repo.addGroupMember(O1, g.id, U.m1); // 멱등
        await expect(repo.addGroupMember(O1, g.id, U.out)).rejects.toMatchObject({ code: '23503' });
        // O2 멤버(out)를 O1 그룹에 O2 로 넣으려 해도 (group_id, org_id) 복합 FK 가 막는다
        await expect(repo.addGroupMember(O2, g.id, U.out)).rejects.toMatchObject({ code: '23503' });
        expect((await repo.listGroups(O1)).find((x) => x.id === g.id)?.member_ids).toEqual([U.m1]);
        await expect(repo.createGroup(id('g-dup'), O1, 'dev', U.pub)).rejects.toMatchObject({ code: '23505' });
        expect(await repo.getGroupOrg(g.id)).toBe(O1);

        await repo.addGroupMember(O1, g.id, U.m2);
        await pool.query(`DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2`, [O1, U.m2]);
        expect((await repo.listGroups(O1)).find((x) => x.id === g.id)?.member_ids).toEqual([U.m1]);
        await pool.query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'member')`, [O1, U.m2]);
    });

    it('② 해석 재료 — 그 멤버 그룹의 덮어쓰기만, 이 조직 공개 항목만', async () => {
        const g = (await repo.listGroups(O1)).find((x) => x.name === 'dev')!;
        await repo.setItemMode(id('e-req'), O1, 'required', U.pub);
        await repo.setItemMode(id('e-on'), O1, 'default_off', U.pub);
        await repo.setGroupMode(id('e-on'), g.id, 'default_on', U.pub);

        const m1 = await repo.listMemberInputs(U.m1, O1);
        expect(m1.map((r) => r.id).sort()).toEqual([id('e-on'), id('e-req')].sort());
        const byId = Object.fromEntries(m1.map((r) => [r.id, resolveDeploymentMode(r.item_mode, r.group_modes)]));
        expect(byId).toEqual({ [id('e-on')]: 'default_on', [id('e-req')]: 'required' });
        // m2 는 그룹 밖 — 항목 기본값만
        const m2 = Object.fromEntries((await repo.listMemberInputs(U.m2, O1)).map((r) => [r.id, resolveDeploymentMode(r.item_mode, r.group_modes)]));
        expect(m2).toEqual({ [id('e-on')]: 'default_off', [id('e-req')]: 'required' });

        const items = await repo.listOrgItems(O1);
        expect(items.find((x) => x.extension_id === id('e-on'))).toMatchObject({ mode: 'default_off', group_modes: { [g.id]: 'default_on' } });

        await repo.setGroupMode(id('e-on'), g.id, null, U.pub);
        expect((await repo.listOrgItems(O1)).find((x) => x.extension_id === id('e-on'))?.group_modes).toEqual({});
        await repo.setGroupMode(id('e-on'), g.id, 'default_on', U.pub);
    });

    it('③ claim 동시성 — 동시에 잡아도 한 쪽만, 설치 완료 뒤엔 다시 잡지 않는다', async () => {
        const src = id('e-req');
        const results = await Promise.all(Array.from({ length: 6 }, () => repo.claimInstall(src, U.m1, O1, 'required', T)));
        expect(results.filter(Boolean)).toHaveLength(1);
        await ext(id('inst-m1-req'), U.m1, 'private', null);
        await repo.markInstalled(src, U.m1, id('inst-m1-req'));
        expect(await repo.claimInstall(src, U.m1, O1, 'required', T)).toBeNull();
        expect((await repo.findByInstalledExtension(id('inst-m1-req'), U.m1))?.state).toBe('installed');
        expect((await repo.listOrgItems(O1)).find((x) => x.extension_id === src)?.installed_count).toBe(1);

        // required 인데 설치본이 다른 경로로 지워졌으면 다시 잡는다
        await pool.query(`UPDATE user_extensions SET status = 'removed' WHERE id = $1`, [id('inst-m1-req')]);
        expect(await repo.claimInstall(src, U.m1, O1, 'default_on', T)).toBeNull();
        expect(await repo.claimInstall(src, U.m1, O1, 'required', T)).not.toBeNull();
    });

    it('④ user_removed · failed 재시도', async () => {
        const src = id('e-on');
        expect(await repo.claimInstall(src, U.m1, O1, 'default_on', T)).not.toBeNull();
        await ext(id('inst-m1-on'), U.m1, 'private', null);
        await repo.markInstalled(src, U.m1, id('inst-m1-on'));
        await repo.markUserRemoved(src, U.m1);
        expect(await repo.claimInstall(src, U.m1, O1, 'default_on', T)).toBeNull();
        expect(await repo.claimInstall(src, U.m1, O1, 'required', T)).not.toBeNull();

        // failed: 간격 전엔 안 잡고, 관리자 재저장(시도 횟수 0)이면 바로 잡는다, 상한에 닿으면 멈춘다
        await repo.markFailed(src, U.m1, 'boom');
        expect(await repo.claimInstall(src, U.m1, O1, 'default_on', T)).toBeNull();
        await repo.setItemMode(src, O1, 'default_off', U.pub);
        const again = await repo.claimInstall(src, U.m1, O1, 'default_on', T);
        expect(again?.attempts).toBe(1);
        await repo.markFailed(src, U.m1, 'boom');
        await pool.query(`UPDATE extension_org_member_installs SET updated_at = NOW() - INTERVAL '2 hours', attempts = $3 WHERE source_extension_id = $1 AND user_id = $2`, [src, U.m1, T.maxAttempts]);
        expect(await repo.claimInstall(src, U.m1, O1, 'default_on', T)).toBeNull();
        await pool.query(`UPDATE extension_org_member_installs SET attempts = 1 WHERE source_extension_id = $1 AND user_id = $2`, [src, U.m1]);
        expect((await repo.claimInstall(src, U.m1, O1, 'default_on', T))?.attempts).toBe(2);
        // 죽은 installing 은 오래되면 다시 잡는다
        expect(await repo.claimInstall(src, U.m1, O1, 'default_on', T)).toBeNull();
        await pool.query(`UPDATE extension_org_member_installs SET updated_at = NOW() - INTERVAL '1 hour' WHERE source_extension_id = $1 AND user_id = $2`, [src, U.m1]);
        expect(await repo.claimInstall(src, U.m1, O1, 'default_on', T)).not.toBeNull();
    });

    it('⑤ 주기 조정 대상 — 활성 조직이 그 조직이고 자동 설치 값이 있는 멤버만', async () => {
        const c = await repo.listReconcileCandidates(100, O1);
        // e-req 가 required 라 활성 조직이 O1 인 세 멤버 모두. O2 멤버십(m1)은 활성 조직이 아니라 제외
        expect(c.map((x) => `${x.org_id}|${x.user_id}`).sort()).toEqual([U.m1, U.m2, U.pub].map((u) => `${O1}|${u}`).sort());
        await repo.setItemMode(id('e-req'), O1, 'default_off', U.pub);
        // 남은 자동 설치 값은 dev 그룹(m1)의 e-on 덮어쓰기뿐
        expect((await repo.listReconcileCandidates(100, O1)).map((x) => x.user_id)).toEqual([U.m1]);
        await repo.setItemMode(id('e-o2'), O2, 'required', U.pub);
        expect(await repo.listReconcileCandidates(100, O2)).toEqual([]);
    });

    it('조직 멤버 선택지 — username 포함, 이 조직 멤버만', async () => {
        const m = await repo.listOrgMembers(O1);
        expect(m.map((x) => x.user_id).sort()).toEqual([U.m1, U.m2, U.pub].sort());
        expect(m.find((x) => x.user_id === U.pub)).toMatchObject({ username: U.pub, role: 'owner' });
    });

    it('항목 범위·그룹 삭제 CASCADE', async () => {
        expect(await repo.getItemScope(id('e-priv'))).toMatchObject({ visibility: 'private', org_id: null });
        expect(await repo.getItemScope('nope')).toBeNull();
        const g = (await repo.listGroups(O1)).find((x) => x.name === 'dev')!;
        expect(await repo.deleteGroup(O2, g.id)).toBe(false);
        expect(await repo.deleteGroup(O1, g.id)).toBe(true);
        expect((await repo.listOrgItems(O1)).find((x) => x.extension_id === id('e-on'))?.group_modes).toEqual({});
    });
});
