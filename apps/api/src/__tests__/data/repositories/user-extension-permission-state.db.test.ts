/**
 * 마이그레이션 190 + UserExtensionPermissionRepository — 실제 Postgres 의미 검증.
 * TEST_DATABASE_URL 이 없으면 skip 한다(로컬 본 DB·운영에 붙지 않는다 — 일회용 컨테이너 전용).
 * 한 연결 안의 TEMP 표(user_extensions·mcp_servers)에 190 을 적용한다. TEMP 표는 검색 경로 맨 앞(pg_temp)이라
 * 같은 이름의 실제 표를 가린다 — 실제 표가 없는 빈 DB 에서도 돈다.
 *  ① 백필: manifest.addonPermissions 배열이 있는 행만 reviewed, 나머지는 legacy_unreviewed
 *  ② 멱등: 두 번 적용해도 오류·변화 없음
 *  ③ CHECK: 모르는 상태 값 거절
 *  ④ jsonb null: granted null 은 SQL NULL 로 저장, reviewedBy null 은 승인 기록을 건드리지 않는다
 *  ⑤ 조건부 저장: 요청 권한이 읽은 값과 다르면 0행
 *  ⑥ MCP 네트워크 제한 → 복원 왕복(권한 표시가 있는 stdio 만 되돌린다)
 *  ⑦ 설치·업데이트 한 문장 저장(UserExtensionRepository.insert·updateAfterReinstall 의 permission)
 *  ⑦-b 업데이트 경합: 읽어 둔 상태·승인(expected)과 저장 값이 다르면 0행 — 그 사이 철회를 덮어쓰지 않는다
 */
import { Pool, type PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { UserExtensionPermissionRepository } from '../../../data/repositories/user-extension-permission-repository';
import { UserExtensionRepository } from '../../../data/repositories/user-extension-repository';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const MIGRATION = fs.readFileSync(
    path.resolve(__dirname, '../../../../../../db/migrations/190_user_extensions_permission_state.sql'),
    'utf8',
);

describeOrSkip('마이그레이션 190 + UserExtensionPermissionRepository (TEMP 표)', () => {
    let pool: Pool;
    let client: PoolClient;
    let repo: UserExtensionPermissionRepository;

    async function stateOf(id: string): Promise<Record<string, unknown>> {
        const r = await client.query(
            `SELECT permission_state, permissions_granted, permissions_requested, permissions_reviewed_by, permissions_reviewed_at
               FROM user_extensions WHERE id = $1`,
            [id],
        );
        return r.rows[0];
    }

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        // 093·094·095·166 의 열(외래 키 제외)
        await client.query(`CREATE TEMP TABLE user_extensions (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL DEFAULT '1.0.0',
            description TEXT, source_url TEXT NOT NULL DEFAULT 'https://example.invalid/x', source_ref TEXT NOT NULL DEFAULT 'sha',
            source_path TEXT NOT NULL DEFAULT 'plugin.json', source_hash TEXT NOT NULL DEFAULT 'h', manifest JSONB NOT NULL,
            status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tracking_ref TEXT, visibility TEXT NOT NULL DEFAULT 'private', org_id TEXT)`);
        await client.query(`CREATE TEMP TABLE mcp_servers (
            id TEXT PRIMARY KEY, extension_id TEXT, transport_type TEXT NOT NULL, sandbox_network TEXT,
            enabled BOOLEAN NOT NULL DEFAULT FALSE, manifest_meta JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await client.query(`INSERT INTO user_extensions (id, user_id, name, manifest) VALUES
            ('ext-legacy', 'u-1', 'legacy', '{"components":{}}'::jsonb),
            ('ext-manifest', 'u-1', 'with-manifest', '{"components":{},"addonPermissions":["network:internet"]}'::jsonb)`);
        await client.query(MIGRATION);
        repo = new UserExtensionPermissionRepository(client as unknown as Pool);
    });

    afterAll(async () => {
        client?.release(true);
        await pool?.end();
    });

    it('① 백필 — addonPermissions 배열이 있는 행만 reviewed, 나머지는 legacy_unreviewed', async () => {
        expect(await stateOf('ext-legacy')).toMatchObject({
            permission_state: 'legacy_unreviewed', permissions_granted: null, permissions_requested: null,
            permissions_reviewed_by: null, permissions_reviewed_at: null,
        });
        expect(await stateOf('ext-manifest')).toMatchObject({
            permission_state: 'reviewed', permissions_granted: ['network:internet'], permissions_requested: ['network:internet'],
            permissions_reviewed_by: 'migration:190',
        });
    });

    it('② 멱등 — 다시 적용해도 오류 없이 같은 결과', async () => {
        await client.query(MIGRATION);
        expect((await stateOf('ext-legacy')).permission_state).toBe('legacy_unreviewed');
        expect((await stateOf('ext-manifest')).permissions_reviewed_by).toBe('migration:190');
    });

    it('③ CHECK — 모르는 상태 값은 거절', async () => {
        await expect(
            client.query(`UPDATE user_extensions SET permission_state = 'approved' WHERE id = 'ext-legacy'`),
        ).rejects.toThrow(/user_extensions_permission_state_chk/);
    });

    it('④ granted·requested null 은 SQL NULL, reviewedBy null 은 승인 기록을 건드리지 않는다', async () => {
        await repo.savePermissionState('ext-legacy', { state: 'reviewed', granted: ['network:internet'], requested: null, reviewedBy: 'u-1' });
        const first = await stateOf('ext-legacy');
        expect(first).toMatchObject({
            permission_state: 'reviewed', permissions_granted: ['network:internet'], permissions_requested: null, permissions_reviewed_by: 'u-1',
        });
        expect(first.permissions_reviewed_at).not.toBeNull();

        await repo.savePermissionState('ext-legacy', { state: 'legacy_unreviewed', granted: null, requested: null, reviewedBy: null });
        const r = await client.query(
            `SELECT permissions_granted IS NULL AS granted_null, jsonb_typeof(permissions_granted) AS granted_type,
                    permissions_reviewed_by
               FROM user_extensions WHERE id = 'ext-legacy'`,
        );
        expect(r.rows[0]).toEqual({ granted_null: true, granted_type: null, permissions_reviewed_by: 'u-1' });
    });

    it('⑤ 조건부 저장 — 요청 권한이 읽은 값과 다르면 0행(null)', async () => {
        // ext-legacy 의 permissions_requested 는 NULL
        expect(await repo.saveReviewIfRequestedUnchanged('ext-legacy', {
            state: 'reviewed', granted: ['network:internet'], reviewedBy: 'admin-1', expectedRequested: [],
        })).toBeNull();
        expect(await repo.saveReviewIfRequestedUnchanged('ext-legacy', {
            state: 'reviewed', granted: ['network:internet'], reviewedBy: 'admin-1', expectedRequested: null,
        })).toMatchObject({ id: 'ext-legacy', permission_state: 'reviewed', permissions_reviewed_by: 'admin-1' });
        expect(await repo.saveReviewIfRequestedUnchanged('ext-manifest', {
            state: 'review_required', granted: [], reviewedBy: 'admin-1', expectedRequested: ['network:internet'],
        })).toMatchObject({ id: 'ext-manifest', permission_state: 'review_required', permissions_granted: [] });
    });

    it('⑥ MCP 네트워크 — 철회는 stdio 를 막고 원격을 끄며, 재승인은 권한으로 막은 stdio 만 되돌린다', async () => {
        await client.query(`INSERT INTO mcp_servers (id, extension_id, transport_type, sandbox_network, enabled, manifest_meta) VALUES
            ('s-stdio', 'ext-manifest', 'stdio', 'full', FALSE, '{}'::jsonb),
            ('s-remote', 'ext-manifest', 'streamable-http', 'full', TRUE, '{}'::jsonb),
            ('s-author-none', 'ext-manifest', 'stdio', 'none', FALSE, '{}'::jsonb),
            ('s-other', 'ext-legacy', 'stdio', 'full', FALSE, '{}'::jsonb)`);

        expect(await repo.restrictLinkedMcpNetwork('ext-manifest')).toEqual({ sandboxed: 1, disabled: 1 });
        const afterRestrict = await client.query(`SELECT id, sandbox_network, enabled, manifest_meta FROM mcp_servers ORDER BY id`);
        expect(afterRestrict.rows).toEqual([
            { id: 's-author-none', sandbox_network: 'none', enabled: false, manifest_meta: {} },
            { id: 's-other', sandbox_network: 'full', enabled: false, manifest_meta: {} },
            { id: 's-remote', sandbox_network: 'full', enabled: false, manifest_meta: { disabledByPermission: true } },
            { id: 's-stdio', sandbox_network: 'none', enabled: false, manifest_meta: { networkRestrictedByPermission: true } },
        ]);

        expect(await repo.restoreLinkedMcpNetwork('ext-manifest')).toBe(1);
        const afterRestore = await client.query(
            `SELECT id, sandbox_network, manifest_meta FROM mcp_servers WHERE id IN ('s-stdio', 's-author-none') ORDER BY id`,
        );
        expect(afterRestore.rows).toEqual([
            { id: 's-author-none', sandbox_network: 'none', manifest_meta: {} },
            { id: 's-stdio', sandbox_network: 'full', manifest_meta: {} },
        ]);
    });

    it('⑦ 설치·업데이트가 상태를 행과 같은 문장으로 쓴다 — reviewedBy null 업데이트는 승인 기록 유지', async () => {
        const extRepo = new UserExtensionRepository(client as unknown as Pool);
        const base = { version: '1.0.0', sourceRef: 'sha1', sourcePath: 'plugin.json', sourceHash: 'h1', manifest: { components: {} } };
        const row = await extRepo.insert({
            ...base, userId: 'u-2', name: 'one-statement', sourceUrl: 'https://example.invalid/y',
            permission: { state: 'reviewed', granted: [], requested: [], reviewedBy: 'u-2' },
        });
        const inserted = await stateOf(row.id);
        expect(inserted).toMatchObject({
            permission_state: 'reviewed', permissions_granted: [], permissions_requested: [], permissions_reviewed_by: 'u-2',
        });
        expect(inserted.permissions_reviewed_at).not.toBeNull();

        await extRepo.updateAfterReinstall(row.id, {
            ...base, sourceRef: 'sha2',
            permission: { state: 'review_required', granted: [], requested: ['network:internet'], reviewedBy: null },
        });
        expect(await stateOf(row.id)).toMatchObject({
            permission_state: 'review_required', permissions_granted: [], permissions_requested: ['network:internet'],
            permissions_reviewed_by: 'u-2', permissions_reviewed_at: inserted.permissions_reviewed_at,
        });

        const plain = await extRepo.insert({ ...base, userId: 'u-2', name: 'no-permission', sourceUrl: 'https://example.invalid/z' });
        expect((await stateOf(plain.id)).permission_state).toBe('legacy_unreviewed');
    });

    it('⑦-b 업데이트가 읽은 뒤 다른 쪽이 승인을 바꿨으면(철회) 0행 — 철회가 남는다', async () => {
        const extRepo = new UserExtensionRepository(client as unknown as Pool);
        const base = { version: '1.0.0', sourceRef: 'sha1', sourcePath: 'plugin.json', sourceHash: 'h1', manifest: { components: {} } };
        const net = ['network:internet'];
        const row = await extRepo.insert({
            ...base, userId: 'u-3', name: 'race', sourceUrl: 'https://example.invalid/r',
            permission: { state: 'reviewed', granted: net, requested: net, reviewedBy: 'u-3' },
        });
        // ingest 가 읽은 값: reviewed · [network]. 그 사이 소유자가 network 를 철회한다
        await repo.saveReviewIfRequestedUnchanged(row.id, { state: 'review_required', granted: [], reviewedBy: 'u-3', expectedRequested: net });
        const lost = await extRepo.updateAfterReinstall(row.id, {
            ...base, sourceRef: 'sha2',
            permission: { state: 'reviewed', granted: net, requested: net, reviewedBy: null },
            expected: { state: 'reviewed', granted: net },
        });
        expect(lost).toBeNull();
        expect(await stateOf(row.id)).toMatchObject({ permission_state: 'review_required', permissions_granted: [] });

        // 읽은 값이 저장 값과 같으면 쓴다(null 승인도 IS NOT DISTINCT FROM 으로 같다고 본다)
        const ok = await extRepo.updateAfterReinstall(row.id, {
            ...base, sourceRef: 'sha3',
            permission: { state: 'review_required', granted: [], requested: net, reviewedBy: null },
            expected: { state: 'review_required', granted: [] },
        });
        expect(ok?.source_ref).toBe('sha3');
        const legacy = await extRepo.insert({ ...base, userId: 'u-3', name: 'race-legacy', sourceUrl: 'https://example.invalid/l' });
        const legacyOk = await extRepo.updateAfterReinstall(legacy.id, {
            ...base, sourceRef: 'sha2',
            permission: { state: 'legacy_unreviewed', granted: null, requested: null, reviewedBy: null },
            expected: { state: 'legacy_unreviewed', granted: null },
        });
        expect(legacyOk).not.toBeNull();
    });
});
