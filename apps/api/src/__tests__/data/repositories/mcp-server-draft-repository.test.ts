/**
 * McpServerDraftRepository — draft CRUD + dedupe.
 *
 * 사용자 결정: 메인 DB 직접 적용. unique UID + try/finally cleanup 으로 격리.
 */
import { Pool } from 'pg';
import { McpServerDraftRepository } from '../../../data/repositories/mcp-server-draft-repository';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const SUFFIX = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const TEST_USER_ID = `test-mcp-draft-${SUFFIX}`;

const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('McpServerDraftRepository', () => {
    let pool: Pool;
    let repo: McpServerDraftRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN });
        repo = new McpServerDraftRepository(pool);
        await pool.query(
            `INSERT INTO users (id, username, password_hash, email, role)
             VALUES ($1, $2, 'no-hash', $3, 'user')
             ON CONFLICT (id) DO NOTHING`,
            [TEST_USER_ID, TEST_USER_ID, `${TEST_USER_ID}@test.local`]
        );
    });

    beforeEach(async () => {
        await pool.query(`DELETE FROM mcp_servers WHERE user_id=$1`, [TEST_USER_ID]);
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM mcp_servers WHERE user_id=$1`, [TEST_USER_ID]);
        await pool.query(`DELETE FROM users WHERE id=$1`, [TEST_USER_ID]);
        await pool.end();
    });

    test('insertDraft — 3중 잠금 (status=draft + enabled=false + visibility=user_private)', async () => {
        const row = await repo.insertDraft({
            name: `pg-test-${SUFFIX}`,
            transportType: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-postgres'],
            env: { DATABASE_URL: '${USER_DATABASE_URL}' },
            url: null,
            createdBy: TEST_USER_ID,
            manifestMeta: { source: 'git-url', gitUrl: 'https://github.com/foo/bar' },
        });
        expect(row.status).toBe('draft');
        expect(row.enabled).toBe(false);
        expect(row.visibility).toBe('user_private');
        expect(row.user_id).toBe(TEST_USER_ID);
        expect(row.command).toBe('npx');
        expect(row.args).toEqual(['-y', '@modelcontextprotocol/server-postgres']);
        expect(row.manifest_meta).toMatchObject({ source: 'git-url' });
    });

    test('listDrafts — 본인의 draft 만, 최신순', async () => {
        const d1 = await repo.insertDraft({
            name: `d1-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [], env: {}, url: null,
            createdBy: TEST_USER_ID, manifestMeta: { source: 'git-url', i: 1 },
        });
        await new Promise(r => setTimeout(r, 10));
        const d2 = await repo.insertDraft({
            name: `d2-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [], env: {}, url: null,
            createdBy: TEST_USER_ID, manifestMeta: { source: 'git-url', i: 2 },
        });
        const list = await repo.listDrafts(TEST_USER_ID);
        expect(list).toHaveLength(2);
        expect(list[0].id).toBe(d2.id);
        expect(list[1].id).toBe(d1.id);
    });

    test('countDraftsForUser', async () => {
        await repo.insertDraft({
            name: `c1-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [], env: {}, url: null,
            createdBy: TEST_USER_ID, manifestMeta: {},
        });
        expect(await repo.countDraftsForUser(TEST_USER_ID)).toBe(1);
    });

    test('approve — draft → active + enabled=true + env merge', async () => {
        const draft = await repo.insertDraft({
            name: `approve-${SUFFIX}`, transportType: 'stdio', command: 'npx', args: [],
            env: { LOG: 'info', DATABASE_URL: '${USER_DATABASE_URL}' },
            url: null, createdBy: TEST_USER_ID, manifestMeta: {},
        });
        const approved = await repo.approve({
            id: draft.id, userId: TEST_USER_ID, isAdmin: false,
            envOverrides: { DATABASE_URL: 'postgres://user@host/db' },
        });
        expect(approved).not.toBeNull();
        expect(approved!.status).toBe('active');
        expect(approved!.enabled).toBe(true);
        expect(approved!.env).toEqual({ LOG: 'info', DATABASE_URL: 'postgres://user@host/db' });
    });

    test('approve — 다른 user 의 row 는 null (admin=false)', async () => {
        const draft = await repo.insertDraft({
            name: `auth-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [],
            env: {}, url: null, createdBy: TEST_USER_ID, manifestMeta: {},
        });
        expect(await repo.approve({ id: draft.id, userId: 'other-user', isAdmin: false })).toBeNull();
    });

    test('approve — admin 은 다른 user 의 row 도 가능', async () => {
        const draft = await repo.insertDraft({
            name: `admin-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [],
            env: {}, url: null, createdBy: TEST_USER_ID, manifestMeta: {},
        });
        const result = await repo.approve({ id: draft.id, userId: 'admin-user', isAdmin: true });
        expect(result?.status).toBe('active');
    });

    test('approve — enableImmediately=false 면 enabled=false 유지', async () => {
        const draft = await repo.insertDraft({
            name: `noenable-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [],
            env: {}, url: null, createdBy: TEST_USER_ID, manifestMeta: {},
        });
        const result = await repo.approve({
            id: draft.id, userId: TEST_USER_ID, isAdmin: false, enableImmediately: false,
        });
        expect(result?.status).toBe('active');
        expect(result?.enabled).toBe(false);
    });

    test('reject — draft → archived', async () => {
        const draft = await repo.insertDraft({
            name: `reject-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [],
            env: {}, url: null, createdBy: TEST_USER_ID, manifestMeta: {},
        });
        const result = await repo.reject(draft.id, TEST_USER_ID, false);
        expect(result?.status).toBe('archived');
    });

    test('reject — 이미 active 인 row 는 null', async () => {
        const draft = await repo.insertDraft({
            name: `already-active-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [],
            env: {}, url: null, createdBy: TEST_USER_ID, manifestMeta: {},
        });
        await repo.approve({ id: draft.id, userId: TEST_USER_ID, isAdmin: false });
        expect(await repo.reject(draft.id, TEST_USER_ID, false)).toBeNull();
    });

    test('findRecentDraftByHash — 24h window 내 동일 hash', async () => {
        const hash = `sha256:dedupe-${SUFFIX}`;
        const draft = await repo.insertDraft({
            name: `dedupe-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [],
            env: {}, url: null, createdBy: TEST_USER_ID,
            manifestMeta: { source: 'git-url', promptHash: hash },
        });
        const found = await repo.findRecentDraftByHash(TEST_USER_ID, hash, 24);
        expect(found?.id).toBe(draft.id);
    });

    test('findRecentDraftByHash — 다른 hash 는 null', async () => {
        await repo.insertDraft({
            name: `no-match-${SUFFIX}`, transportType: 'stdio', command: '/bin/true', args: [],
            env: {}, url: null, createdBy: TEST_USER_ID,
            manifestMeta: { source: 'git-url', promptHash: 'sha256:other' },
        });
        expect(await repo.findRecentDraftByHash(TEST_USER_ID, `sha256:nope-${SUFFIX}`, 24)).toBeNull();
    });
});
