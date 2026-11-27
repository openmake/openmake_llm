/**
 * 조직 소유 확장(212) — 실제 Postgres(TEST_DATABASE_URL — 일회용 DB 전용, 없으면 skip).
 *
 *  ① 설치한 관리자가 계정 삭제(UserManager.deleteUser — add-on 데이터 모듈 fail-closed 정리 포함)돼도 조직 소유 행은 남고
 *     installed_by_user_id 만 NULL 이 된다. 같은 사람의 개인 행은 종전처럼 CASCADE 로 지워진다.
 *  ② 설치자가 조직을 떠나도(organization_members 삭제) 행은 남고, 남은 관리자가 업데이트·제거한다.
 *  ③ 조직 공개 갤러리(listShared·getInstallableById)에 같은 조건으로 나온다 — 멤버에게만.
 *  ④ CHECK: 소유자는 정확히 한쪽 · 조직 소유 행은 그 조직 공개 상태로만 · 조직 안 active 이름 유일.
 *  ⑤ 개인 경로(`user_id = $n`)의 조회·제거는 조직 소유 행에 닿지 않는다.
 *  ⑥ 조직이 지워지면 조직 소유 행도 지워진다.
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const CONN = process.env.TEST_DATABASE_URL;
let mockPool: Pool;
jest.mock('../../data/models/unified-database', () => ({
    getPool: () => mockPool,
    getUnifiedDatabase: () => ({ getPool: () => mockPool }),
}));
jest.mock('../../services/local-bridge/registry', () => ({ getLocalBridgeRegistry: () => ({ disconnectByUser: jest.fn() }) }));

import { getUserManager } from '../../data/user-manager';
import { OrgOwnedExtensionRepository } from '../../data/repositories/org-owned-extension-repository';
import { UserExtensionRepository } from '../../data/repositories/user-extension-repository';
import { getAddonDataModules } from '../../addon-host/addon-data';
import { listInstalledExtensionsBySources } from '../../data/extension-catalog-lookup';
import { ExtensionInventoryRepository } from '../../data/repositories/extension-inventory-repository';
import { removeOrgOwnedExtension, updateOrgOwnedExtension, type OrgOwnedDeps } from '../../services/extensions/org-owned-install';
import type { ResolvedExtensionSource } from '../../agents/git-ingest/extension-source-resolver';

const describeOrSkip = CONN ? describe : describe.skip;
const TAG = randomUUID().slice(0, 8);
const ids = { installer: `s85b-inst-${TAG}`, other: `s85b-adm-${TAG}`, member: `s85b-mem-${TAG}`, outsider: `s85b-out-${TAG}`, admin: `s85b-root-${TAG}` };
const ORG = `s85b-org-${TAG}`;
const SRC = { name: 'org-pack', version: '1.0.0', sourceUrl: 'https://github.com/acme/org-pack', sourceRef: 'a'.repeat(40), sourcePath: '.claude-plugin/plugin.json', sourceHash: 'sha256:o', trackingRef: 'main', manifest: { orgOwned: true } };

describeOrSkip('조직 소유 확장 (212, 실제 Postgres)', () => {
    beforeAll(async () => {
        mockPool = new Pool({ connectionString: CONN, max: 4 });
        // 마지막 관리자 보호에 걸리지 않게 활성 관리자 하나를 둔다
        for (const [k, id] of Object.entries(ids)) {
            await mockPool.query(`INSERT INTO users (id, username, password_hash, role) VALUES ($1, $1, 'x', $2)`, [id, k === 'admin' ? 'admin' : 'user']);
        }
        await mockPool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1)`, [ORG]);
        await mockPool.query(
            `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'admin'), ($1, $4, 'member')`,
            [ORG, ids.installer, ids.other, ids.member],
        );
        await getUserManager().ensureReady().catch(() => undefined);
    });

    afterAll(async () => {
        await mockPool.query(`DELETE FROM user_extensions WHERE owner_org_id = $1 OR user_id = ANY($2::text[])`, [ORG, Object.values(ids)]);
        await mockPool.query(`DELETE FROM organizations WHERE id = $1`, [ORG]);
        await mockPool.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [Object.values(ids)]);
        await mockPool.end();
    });

    let orgRowId = '';
    let personalRowId = '';

    it('① 설치자 계정 삭제 — 조직 소유 행은 남고(installed_by NULL), 개인 행은 CASCADE', async () => {
        const row = await new OrgOwnedExtensionRepository(mockPool).insert(ORG, ids.installer, SRC);
        orgRowId = row.id;
        expect(row).toMatchObject({ user_id: null, owner_org_id: ORG, org_id: ORG, visibility: 'organization', installed_by_user_id: ids.installer });
        const personal = await new UserExtensionRepository(mockPool).insert({
            userId: ids.installer, name: 'personal-pack', version: '1.0.0', description: null, sourceUrl: 'https://github.com/acme/p',
            sourceRef: 'b'.repeat(40), sourcePath: '.claude-plugin/plugin.json', sourceHash: `sha256:p-${TAG}`, trackingRef: null, manifest: {},
        } as never);
        personalRowId = personal.id;

        // 실제 add-on 데이터 모듈(fail-closed) 그대로 — 불러오지 못한 모듈이 있으면 삭제가 거절돼 이 테스트가 깨진다
        expect(getAddonDataModules().filter((m) => m.error)).toEqual([]);
        expect(await getUserManager().deleteUser(ids.installer)).toBe(true);

        const left = await mockPool.query(`SELECT id, user_id, owner_org_id, installed_by_user_id, status FROM user_extensions WHERE id = ANY($1::text[])`, [[orgRowId, personalRowId]]);
        expect(left.rows).toEqual([{ id: orgRowId, user_id: null, owner_org_id: ORG, installed_by_user_id: null, status: 'active' }]);
    });

    it('③ 갤러리 — 조직 멤버에게 같은 조건(listShared·getInstallableById)으로 나오고 밖의 사람에겐 없다', async () => {
        const repo = new UserExtensionRepository(mockPool);
        expect((await repo.listShared(100, [ORG])).map((r) => r.id)).toContain(orgRowId);
        expect((await repo.listShared(100, [])).map((r) => r.id)).not.toContain(orgRowId);
        expect((await repo.getInstallableById(orgRowId, ids.member, [ORG]))?.id).toBe(orgRowId);
        expect(await repo.getInstallableById(orgRowId, ids.outsider, [])).toBeNull();
        // 카탈로그 설치본 근거는 사람 소유 설치본만 — 구성요소 없는 조직 소유 행은 근거가 아니다
        expect((await listInstalledExtensionsBySources([SRC.sourceUrl])).map((r) => r.name)).not.toContain('org-pack');
        // 관리자 현황은 소유 조직 id·이름을 함께 읽는다(소유자 칸 — 서비스가 플래그 ON 일 때만 싣는다)
        const inv = (await new ExtensionInventoryRepository(mockPool).listPage({}, 500, null)).find((r) => r.id === orgRowId);
        expect(inv).toMatchObject({ user_id: null, username: null, owner_org_id: ORG, owner_org_name: ORG });
    });

    it('⑤ 개인 경로는 조직 소유 행에 닿지 않는다(개인 조회·제거)', async () => {
        const repo = new UserExtensionRepository(mockPool);
        expect(await repo.getByIdForUser(orgRowId, ids.other, false)).toBeNull();
        expect(await repo.remove(orgRowId, ids.other, false)).toBeNull();
        const r = await mockPool.query(`SELECT status FROM user_extensions WHERE id = $1`, [orgRowId]);
        expect(r.rows[0].status).toBe('active');
    });

    it('② 설치자가 아닌 남은 조직 관리자가 업데이트·제거 — 감사 2건', async () => {
        const audit = jest.fn(async () => undefined);
        const deps: OrgOwnedDeps = {
            pool: mockPool,
            resolveSource: async () => ({
                sha: 'c'.repeat(40), effectiveGitUrl: SRC.sourceUrl, effectiveTrackingRef: 'main', candidate: { path: SRC.sourcePath },
                manifest: { name: 'org-pack', version: '1.1.0', raw: {} }, warnings: [],
            } as unknown as ResolvedExtensionSource),
            activeOrg: async () => ({ orgId: ORG, orgRole: 'admin' }),
            audit,
        };
        const up = await updateOrgOwnedExtension(deps, { userId: ids.other, role: 'user' }, orgRowId);
        expect(up).toMatchObject({ upToDate: false, previousRef: 'a'.repeat(40) });
        expect(up.row).toMatchObject({ source_ref: 'c'.repeat(40), version: '1.1.0' });
        // 멤버는 못 지운다
        await expect(removeOrgOwnedExtension({ ...deps, activeOrg: async () => ({ orgId: ORG, orgRole: 'member' }) }, { userId: ids.member, role: 'user' }, orgRowId))
            .rejects.toMatchObject({ statusCode: 403 });
        await removeOrgOwnedExtension(deps, { userId: ids.other, role: 'user' }, orgRowId);
        expect(audit).toHaveBeenCalledTimes(2);
        const r = await mockPool.query(`SELECT status FROM user_extensions WHERE id = $1`, [orgRowId]);
        expect(r.rows[0].status).toBe('removed');
    });

    it('④ CHECK — 소유자 정확히 한쪽·조직 공개 상태로만·조직 안 active 이름 유일', async () => {
        const base = `(id, name, version, source_url, source_ref, source_path, source_hash, manifest, status`;
        const vals = `'x', '1', 'u', 'r', 'p', 'h', '{}'::jsonb, 'active'`;
        // 양쪽 다 없음
        await expect(mockPool.query(`INSERT INTO user_extensions ${base}) VALUES ('s85b-${TAG}-n', ${vals})`)).rejects.toMatchObject({ code: '23514' });
        // 양쪽 다 있음
        await expect(mockPool.query(`INSERT INTO user_extensions ${base}, user_id, owner_org_id, visibility, org_id) VALUES ('s85b-${TAG}-b', ${vals}, $1, $2, 'organization', $2)`, [ids.other, ORG]))
            .rejects.toMatchObject({ code: '23514' });
        // 조직 소유인데 비공개
        await expect(mockPool.query(`INSERT INTO user_extensions ${base}, owner_org_id, visibility) VALUES ('s85b-${TAG}-v', ${vals}, $1, 'private')`, [ORG]))
            .rejects.toMatchObject({ code: '23514' });
        // 같은 조직 같은 이름 active 2개
        const repo = new OrgOwnedExtensionRepository(mockPool);
        await repo.insert(ORG, ids.other, { ...SRC, sourceHash: 'sha256:d1' });
        await expect(repo.insert(ORG, ids.other, { ...SRC, sourceHash: 'sha256:d2' })).rejects.toThrow(/ORG_OWNED_NAME_CONFLICT/);
    });

    it('⑥ 조직 삭제 → 조직 소유 행도 삭제', async () => {
        const org2 = `${ORG}-2`;
        await mockPool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1)`, [org2]);
        const row = await new OrgOwnedExtensionRepository(mockPool).insert(org2, ids.other, SRC);
        await mockPool.query(`DELETE FROM organizations WHERE id = $1`, [org2]);
        const r = await mockPool.query(`SELECT 1 FROM user_extensions WHERE id = $1`, [row.id]);
        expect(r.rowCount).toBe(0);
    });
});
