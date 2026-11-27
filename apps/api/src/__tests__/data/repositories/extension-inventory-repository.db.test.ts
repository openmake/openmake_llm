/**
 * ExtensionInventoryRepository(M3) + MCP 구성요소 저장 연산 listLinkedDetails — 실제 Postgres SQL 의미 검증.
 * 한 연결 안의 TEMP 표(검색 경로 맨 앞 pg_temp 라 실제 표를 가린다). TEST_DATABASE_URL 이 없으면 skip.
 *  ① 필터(q·userId·source·status)·LIKE 이스케이프 ② keyset 커서(created_at desc, id desc) ③ addon_installations ext: 상태
 *  ④ 원본별 집계 ⑤ 에이전트 구성요소
 */
import { Pool, type PoolClient } from 'pg';
import { ExtensionInventoryRepository } from '../../../data/repositories/extension-inventory-repository';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('ExtensionInventoryRepository (TEMP 표)', () => {
    let pool: Pool;
    let client: PoolClient;
    let repo: ExtensionInventoryRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        await client.query(`CREATE TEMP TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, email TEXT)`);
        await client.query(`CREATE TEMP TABLE user_extensions (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL DEFAULT '1.0.0',
            source_url TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT 'sha', source_path TEXT NOT NULL DEFAULT 'plugin.json',
            source_hash TEXT NOT NULL DEFAULT 'h', tracking_ref TEXT, status TEXT NOT NULL DEFAULT 'active',
            visibility TEXT NOT NULL DEFAULT 'private', org_id TEXT, permission_state TEXT NOT NULL DEFAULT 'legacy_unreviewed',
            owner_org_id TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await client.query(`CREATE TEMP TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
        await client.query(`CREATE TEMP TABLE addon_installations (addon_id TEXT PRIMARY KEY, state TEXT NOT NULL)`);
        await client.query(`CREATE TEMP TABLE user_agents (
            id TEXT PRIMARY KEY, extension_id TEXT, name TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, approval_status TEXT)`);

        await client.query(`INSERT INTO users VALUES ('u1', 'alice', 'alice@example.com'), ('u2', 'bob', 'bob@example.com')`);
        await client.query(`INSERT INTO user_extensions (id, user_id, name, source_url, status, created_at) VALUES
            ('e1', 'u1', 'pack-a', 'https://github.com/openmake/pack', 'active', '2026-11-27T03:00:00Z'),
            ('e2', 'u1', 'pack_b', 'https://github.com/openmake/pack', 'active', '2026-11-27T02:00:00Z'),
            ('e3', 'u2', 'other', 'https://example.com/x.zip', 'removed', '2026-11-27T02:00:00Z'),
            ('e4', 'u2', 'pct%name', 'https://github.com/bob/tools', 'active', '2026-11-27T01:00:00Z')`);
        await client.query(`INSERT INTO addon_installations VALUES ('ext:e1', 'enabled')`);
        await client.query(`INSERT INTO user_agents VALUES ('a1', 'e1', 'agent-x', TRUE, 'pending'), ('a2', 'e2', 'agent-y', FALSE, 'approved')`);
        repo = new ExtensionInventoryRepository(client as unknown as Pool);
    });
    afterAll(async () => { client?.release(true); await pool?.end(); });

    it('정렬(created_at desc, id desc)·소유자·ext: 상태', async () => {
        const rows = await repo.listPage({}, 10, null);
        expect(rows.map((r) => r.id)).toEqual(['e1', 'e3', 'e2', 'e4']);
        expect(rows[0]).toMatchObject({ username: 'alice', email: 'alice@example.com', install_state: 'enabled' });
        expect(rows[1].install_state).toBeNull();
    });

    it('keyset 커서 — 같은 created_at 은 id 로 이어진다', async () => {
        const first = await repo.listPage({}, 2, null);
        const last = first[first.length - 1];
        const next = await repo.listPage({}, 10, { createdAt: new Date(last.created_at).toISOString(), id: last.id });
        expect([...first, ...next].map((r) => r.id)).toEqual(['e1', 'e3', 'e2', 'e4']);
    });

    it('필터 — status·userId·source·q(소유자 이메일 포함), LIKE 메타문자는 글자 그대로', async () => {
        expect((await repo.listPage({ status: 'removed' }, 10, null)).map((r) => r.id)).toEqual(['e3']);
        expect((await repo.listPage({ userId: 'u2' }, 10, null)).map((r) => r.id)).toEqual(['e3', 'e4']);
        expect((await repo.listPage({ source: 'openmake/pack' }, 10, null)).map((r) => r.id)).toEqual(['e1', 'e2']);
        expect((await repo.listPage({ q: 'BOB@example' }, 10, null)).map((r) => r.id)).toEqual(['e3', 'e4']);
        expect((await repo.listPage({ q: 'pct%' }, 10, null)).map((r) => r.id)).toEqual(['e4']);
        // `_` 가 한 글자 와일드카드로 쓰이면 pack-a 도 걸린다
        expect((await repo.listPage({ q: 'pack_' }, 10, null)).map((r) => r.id)).toEqual(['e2']);
    });

    it('필터 조합 — 상태·사용자·원본·검색어를 함께, 커서($1·$2) 뒤 번호도 맞는다', async () => {
        // 네 필터 동시: 각 값이 제자리 placeholder 에 묶여야 e2 하나만 남는다(번호가 밀리면 타입 오류 또는 0건)
        expect((await repo.listPage({ status: 'active', userId: 'u1', source: 'openmake/pack', q: 'pack_' }, 10, null))
            .map((r) => r.id)).toEqual(['e2']);
        expect((await repo.listPage({ status: 'active', userId: 'u2' }, 10, null)).map((r) => r.id)).toEqual(['e4']);
        expect((await repo.listPage({ userId: 'u1', source: 'example.com' }, 10, null))).toEqual([]);
        // 커서 + 필터 조합 — 커서가 $1·$2 를 먼저 쓰고 필터는 $3 부터, LIMIT 은 마지막
        const first = await repo.listPage({ status: 'active', userId: 'u1' }, 1, null);
        expect(first.map((r) => r.id)).toEqual(['e1']);
        const rest = await repo.listPage({ status: 'active', userId: 'u1', source: 'openmake' },
            10, { createdAt: new Date(first[0].created_at).toISOString(), id: first[0].id });
        expect(rest.map((r) => r.id)).toEqual(['e2']);
        const all = await repo.listPage({ status: 'active', q: 'github.com' }, 10, { createdAt: '2026-11-27T02:30:00Z', id: 'zz' });
        expect(all.map((r) => r.id)).toEqual(['e2', 'e4']);
        // 집계도 같은 조합으로
        const s = await repo.summarizeSources({ status: 'active', userId: 'u2', source: 'github.com', q: 'bob' }, 10);
        expect(s).toEqual([expect.objectContaining({ source_url: 'https://github.com/bob/tools', installs: 1, users: 1 })]);
    });

    it('원본별 집계 — 설치 수·사용자 수', async () => {
        const s = await repo.summarizeSources({ status: 'active' }, 10);
        expect(s[0]).toMatchObject({ source_url: 'https://github.com/openmake/pack', installs: 2, users: 1 });
        expect(s.map((x) => x.source_url)).not.toContain('https://example.com/x.zip');
    });

    it('정책 미리보기 대상은 활성 설치만', async () => {
        expect((await repo.listActiveForPreview(100)).map((r) => r.id)).toEqual(['e1', 'e2', 'e4']);
    });

    it('에이전트 구성요소 상태(draft·archived)', async () => {
        const a = await repo.listAgentsByExtensions(['e1', 'e2']);
        expect(a).toEqual([
            { id: 'a1', extension_id: 'e1', name: 'agent-x', status: 'draft' },
            { id: 'a2', extension_id: 'e2', name: 'agent-y', status: 'archived' },
        ]);
        expect(await repo.listAgentsByExtensions([])).toEqual([]);
    });
});
