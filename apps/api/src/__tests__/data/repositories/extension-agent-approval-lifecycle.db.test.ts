/**
 * 확장 번들 Custom Agent 승인 수명주기 — 실제 Postgres SQL 의미 검증(승인 대기 EXTENSION_AGENT_APPROVAL_REQUIRED, 206 · 출처·정리 opt-in EXTENSION_AGENT_BUNDLE_PROVENANCE).
 * 한 연결 안의 TEMP 표(pg_temp 가 검색 경로 맨 앞이라 실제 표를 가린다). TEST_DATABASE_URL 이 없으면 skip.
 *
 *  ① pending 은 실행 경로(loadUserAgent 가 쓰는 getByIdVisibleToUser)·목록·공유 전환에 안 보이고 승인함에만 보인다
 *  ② 승인함 목록은 opt-in 일 때 확장 이름·원본·커밋을 싣는다(꺼져 있으면 종전 모양)
 *  ③ 업데이트 — 내용이 같은 에이전트는 승인을 이어받고, 바뀐 에이전트는 pending 으로 남는다(지문 opt-in)
 *  ④ 제거 — 전부 soft-delete, opt-in 이면 한 번도 승인되지 않은 에이전트의 이름을 비켜 재설치 이름 표류를 막는다
 */
import { Pool, type PoolClient } from 'pg';

// 스킬·MCP 구성요소 저장 연산(add-on 데이터 모듈)은 이 테스트의 대상이 아니다 — no-op 으로 둔다
jest.mock('../../../addon-host/addon-data', () => ({
    getComponentStore: () => ({ archiveLinked: async () => undefined, link: async () => undefined }),
}));

import { UserAgentRepository } from '../../../data/repositories/user-agent-repository';
import { UserExtensionRepository } from '../../../data/repositories/user-extension-repository';
import { resetConfig } from '../../../config/env';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const ORIGINAL = process.env.EXTENSION_AGENT_BUNDLE_PROVENANCE;
/** 플래그는 getConfig 캐시를 거친다 — 바꿀 때마다 캐시를 비운다 */
function setProvenance(on: boolean | undefined): void {
    if (on === undefined) delete process.env.EXTENSION_AGENT_BUNDLE_PROVENANCE;
    else process.env.EXTENSION_AGENT_BUNDLE_PROVENANCE = on ? 'true' : 'false';
    resetConfig();
}


describeOrSkip('확장 Custom Agent 승인 수명주기 (TEMP 표)', () => {
    let pool: Pool;
    let client: PoolClient;
    let agents: UserAgentRepository;
    let exts: UserExtensionRepository;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        await client.query(`CREATE TEMP TABLE user_extensions (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, source_url TEXT NOT NULL,
            source_ref TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await client.query(`CREATE TEMP TABLE user_agents (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, system_prompt TEXT NOT NULL,
            allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb, allowed_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
            icon TEXT, model TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE, usage_count INTEGER NOT NULL DEFAULT 0,
            visibility TEXT NOT NULL DEFAULT 'private', org_id TEXT, extension_id TEXT,
            approval_status TEXT NOT NULL DEFAULT 'approved',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (user_id, name))`);
        agents = new UserAgentRepository(client as unknown as Pool);
        exts = new UserExtensionRepository(client as unknown as Pool);
    });
    afterAll(async () => {
        setProvenance(ORIGINAL === undefined ? undefined : ORIGINAL === 'true');
        client?.release(true);
        await pool?.end();
    });
    beforeEach(async () => {
        await client.query('DELETE FROM user_agents');
        await client.query('DELETE FROM user_extensions');
        await client.query(`INSERT INTO user_extensions (id, user_id, name, source_url, source_ref)
            VALUES ('e1', 'u1', 'review-pack', 'https://github.com/acme/review-pack', 'abcdef0123456789')`);
    });

    async function installPending(id: string, name: string, prompt: string): Promise<void> {
        await agents.create({ id, userId: 'u1', name, systemPrompt: prompt, approvalStatus: 'pending', extensionId: null });
        await exts.linkComponents('e1', [], [], [id]);
    }

    it('① pending 은 실행·목록·공유에서 빠지고 승인 뒤에만 쓰인다', async () => {
        await installPending('a1', 'review-pack-reviewer', '너는 꼼꼼한 리뷰어다. 변경을 검토한다.');
        expect(await agents.getByIdVisibleToUser('a1', 'u1')).toBeUndefined();
        expect((await agents.listVisibleToUser('u1')).map(a => a.id)).toEqual([]);
        expect(await agents.setVisibility('a1', 'u1', 'shared')).toBeUndefined();
        expect(await agents.countPendingForUser('u1')).toBe(1);
        expect(await agents.countPendingForUser('u2')).toBe(0);
        // 남의 승인은 불가
        expect(await agents.approve('a1', 'u2')).toBeUndefined();

        expect((await agents.approve('a1', 'u1'))?.approval_status).toBe('approved');
        expect((await agents.getByIdVisibleToUser('a1', 'u1'))?.id).toBe('a1');
        expect((await agents.listVisibleToUser('u1')).map(a => a.id)).toEqual(['a1']);
        expect(await agents.countPendingForUser('u1')).toBe(0);
    });

    it('② 승인함 목록 — withOrigin 이면 확장 이름·원본·커밋, 아니면 종전 모양', async () => {
        await installPending('a1', 'review-pack-reviewer', '너는 꼼꼼한 리뷰어다. 변경을 검토한다.');
        const plain = await agents.listPendingForUser('u1');
        expect(plain).toHaveLength(1);
        expect(plain[0]).not.toHaveProperty('extension_name');
        const withOrigin = await agents.listPendingForUser('u1', { withOrigin: true });
        expect(withOrigin[0]).toMatchObject({
            id: 'a1', extension_name: 'review-pack',
            extension_source_url: 'https://github.com/acme/review-pack', extension_source_ref: 'abcdef0123456789',
        });
        // 확장 레코드가 없으면 출처는 NULL(목록에서 빠지지 않는다)
        await agents.create({ id: 'a2', userId: 'u1', name: 'orphan', systemPrompt: '확장 링크가 없는 대기 에이전트', approvalStatus: 'pending' });
        const both = await agents.listPendingForUser('u1', { withOrigin: true });
        expect(both.find(a => a.id === 'a2')).toMatchObject({ extension_name: null, extension_source_url: null });
    });

    it('③ 업데이트 — 같은 내용은 승인을 이어받고 바뀐 내용은 재승인 대기', async () => {
        await installPending('a1', 'review-pack-same', '바뀌지 않는 시스템 프롬프트다.');
        await installPending('a2', 'review-pack-changed', '업데이트 전 시스템 프롬프트다.');
        await agents.approve('a1', 'u1');
        await agents.approve('a2', 'u1');

        // ingest 업데이트 순서: 스냅샷 → 구성요소 회수(이름 비킴) → 새 구성요소(pending) 설치·링크 → 이어받기
        const snapshot = await exts.snapshotApprovedAgents('e1');
        expect(snapshot.map(s => s.name).sort()).toEqual(['review-pack-changed', 'review-pack-same']);
        await exts.archiveLinkedComponents('e1');
        expect(await agents.getByIdVisibleToUser('a1', 'u1')).toBeUndefined();
        await installPending('b1', 'review-pack-same', '바뀌지 않는 시스템 프롬프트다.');
        await installPending('b2', 'review-pack-changed', '업데이트 후 — 지시가 바뀐 시스템 프롬프트다.');

        const carried = await exts.carryOverAgentApprovals(
            [{ agentId: 'b1', storedName: 'review-pack-same' }, { agentId: 'b2', storedName: 'review-pack-changed' }],
            snapshot, { requireSameContent: true },
        );
        expect(carried).toEqual(['b1']);
        expect((await agents.getByIdVisibleToUser('b1', 'u1'))?.id).toBe('b1');
        expect(await agents.getByIdVisibleToUser('b2', 'u1')).toBeUndefined();
        expect((await agents.listPendingForUser('u1')).map(a => a.id)).toEqual(['b2']);
    });

    it('④ 제거 — opt-in 이면 승인 전 에이전트의 이름을 비키고, 승인된 것은 이름을 유지한다', async () => {
        setProvenance(true);
        await installPending('a1', 'review-pack-approved', '승인된 에이전트의 시스템 프롬프트.');
        await installPending('a2', 'review-pack-waiting', '승인 대기 에이전트의 시스템 프롬프트.');
        await agents.approve('a1', 'u1');

        expect(await exts.remove('e1', 'u1', false)).not.toBeNull();
        const rows = (await client.query<{ id: string; name: string; is_active: boolean }>(
            'SELECT id, name, is_active FROM user_agents ORDER BY id')).rows;
        expect(rows.every(r => !r.is_active)).toBe(true);
        expect(rows[0].name).toBe('review-pack-approved');
        expect(rows[1].name).toMatch(/^review-pack-waiting-removed-[0-9a-f]{6}$/);
        expect(await agents.existsByName('u1', 'review-pack-waiting')).toBe(false);
        expect(await agents.countPendingForUser('u1')).toBe(0);
    });

    it('④ 제거 — 옵션이 꺼져 있으면 종전대로 soft-delete 만(이름 유지)', async () => {
        setProvenance(false);
        await installPending('a2', 'review-pack-waiting', '승인 대기 에이전트의 시스템 프롬프트.');
        expect(await exts.remove('e1', 'u1', false)).not.toBeNull();
        const row = (await client.query<{ name: string; is_active: boolean }>('SELECT name, is_active FROM user_agents')).rows[0];
        expect(row).toEqual({ name: 'review-pack-waiting', is_active: false });
    });
});
