/**
 * 마이그레이션 198 — 대화 읽기 전용 공유(conversation_shares·conversation_share_previews), 실제 Postgres 의미 검증.
 * TEST_DATABASE_URL 이 없으면 skip 한다(로컬 본 DB·운영에 붙지 않는다 — 전용 테스트 DB 에서만).
 *
 * 탈퇴·조직 삭제 처리는 trigger 이고 여러 연결이 얽히므로 TEMP 표가 아니라 테스트 DB 의 실제 표를 쓴다.
 * 고유 접두사 fixture 만 만들고 끝나면 지운다. 198 은 멱등이라 beforeAll 에서 한 번 더 적용한다.
 *  ① CHECK·UNIQUE·FK — 범위별 org_id/token 조합, 세션당 한 건, 세션 삭제 CASCADE
 *  ② 소유자 탈퇴 → private 영구 전환 + 감사 1행(system), 열람자 탈퇴는 공유를 바꾸지 않는다
 *  ③ 조직 삭제 → private 전환 + 감사 1행(멤버 cascade 가 중복 감사하지 않는다), org 미리보기 CASCADE
 *  ④ 멤버 PK 변경은 탈퇴로 본다, 역할만 바꾸면 영향 없음
 *  ⑤ 재가입해도 private 유지
 *  ⑥ 사용자 삭제 → 공유 CASCADE(오류 없음)
 *  ⑦ 롤백 SQL — 접근 차단(private)만, 행·snapshot 은 보존. 198 재적용으로 trigger 복구
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const MIGRATIONS = path.resolve(__dirname, '../../../../../db/migrations');
const FORWARD = fs.readFileSync(path.join(MIGRATIONS, '198_conversation_shares.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(MIGRATIONS, 'rollbacks/198_conversation_shares_rollback.sql'), 'utf8');

const P = `cst-${randomUUID().slice(0, 8)}`;
const SNAP = JSON.stringify({ schemaVersion: 1, title: 't', messages: [{ role: 'user', content: 'hi' }] });

describeOrSkip('마이그레이션 198 — 대화 공유 표·탈퇴 trigger (테스트 DB 실제 표)', () => {
    let pool: Pool;
    const users: string[] = [];
    const orgs: string[] = [];

    async function user(name: string): Promise<string> {
        const id = `${P}-u-${name}-${randomUUID().slice(0, 6)}`;
        await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [id]);
        users.push(id);
        return id;
    }
    async function org(name: string): Promise<string> {
        const id = `${P}-o-${name}-${randomUUID().slice(0, 6)}`;
        await pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1)`, [id]);
        orgs.push(id);
        return id;
    }
    async function member(orgId: string, userId: string, role = 'member'): Promise<void> {
        await pool.query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, $3)`, [orgId, userId, role]);
    }
    async function session(ownerId: string): Promise<string> {
        const id = `${P}-s-${randomUUID().slice(0, 8)}`;
        await pool.query(`INSERT INTO conversation_sessions (id, user_id, title) VALUES ($1, $2, 't')`, [id, ownerId]);
        return id;
    }
    async function share(sessionId: string, ownerId: string, visibility: string, orgId: string | null = null, token: string | null = null): Promise<string> {
        const id = randomUUID();
        await pool.query(
            `INSERT INTO conversation_shares (share_id, session_id, owner_user_id, visibility, org_id, share_token, snapshot, snapshot_captured_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
            [id, sessionId, ownerId, visibility, orgId, token, SNAP],
        );
        return id;
    }
    async function shareRow(shareId: string): Promise<{ visibility: string; org_id: string | null; share_token: string | null; revision: string } | undefined> {
        const r = await pool.query(`SELECT visibility, org_id, share_token, revision FROM conversation_shares WHERE share_id = $1`, [shareId]);
        return r.rows[0];
    }
    async function audits(shareId: string): Promise<Array<{ action: string; user_id: string | null; details: Record<string, unknown> }>> {
        const r = await pool.query(
            `SELECT action, user_id, details FROM audit_logs WHERE resource_type = 'conversation_share' AND resource_id = $1 ORDER BY id`,
            [shareId],
        );
        return r.rows;
    }
    async function orgShareFixture(): Promise<{ owner: string; viewer: string; orgId: string; shareId: string }> {
        const owner = await user('owner');
        const viewer = await user('viewer');
        const orgId = await org('o');
        await member(orgId, owner, 'owner');
        await member(orgId, viewer);
        const shareId = await share(await session(owner), owner, 'org', orgId);
        return { owner, viewer, orgId, shareId };
    }

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 4 });
        await pool.query(FORWARD);
    });

    afterAll(async () => {
        if (pool) {
            await pool.query(`DELETE FROM organizations WHERE id = ANY($1::text[])`, [orgs]);
            await pool.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [users]);
            await pool.end();
        }
    });

    it('멱등 — 다시 적용해도 오류가 없다', async () => {
        await expect(pool.query(FORWARD)).resolves.toBeDefined();
    });

    it('① CHECK — org 는 org_id 필수, link 는 토큰 필수, 다른 범위는 둘 다 NULL', async () => {
        const owner = await user('chk');
        const orgId = await org('chk');
        const bad: Array<[string, string | null, string | null]> = [
            ['org', null, null],
            ['private', orgId, null],
            ['authenticated', orgId, null],
            ['link', null, null],
            ['private', null, 'tok'],
            ['org', orgId, 'tok'],
            ['public', null, null],
        ];
        for (const [vis, o, tok] of bad) {
            await expect(share(await session(owner), owner, vis, o, tok)).rejects.toMatchObject({ code: '23514' });
        }
        await expect(share(await session(owner), owner, 'link', null, 'tok')).resolves.toEqual(expect.any(String));
        await expect(share(await session(owner), owner, 'authenticated')).resolves.toEqual(expect.any(String));
    });

    it('① UNIQUE·FK — 세션당 한 건, 없는 조직 거절, 세션 삭제 시 공유·미리보기 CASCADE', async () => {
        const owner = await user('fk');
        const sid = await session(owner);
        const shareId = await share(sid, owner, 'private');
        await expect(share(sid, owner, 'private')).rejects.toMatchObject({ code: '23505' });
        await expect(share(await session(owner), owner, 'org', `${P}-missing-org`)).rejects.toMatchObject({ code: '23503' });

        await pool.query(
            `INSERT INTO conversation_share_previews (preview_id, session_id, owner_user_id, visibility, snapshot, expires_at)
             VALUES ($1, $2, $3, 'private', $4::jsonb, NOW() + INTERVAL '15 minutes')`,
            [randomUUID(), sid, owner, SNAP],
        );
        await pool.query(`DELETE FROM conversation_sessions WHERE id = $1`, [sid]);
        expect(await shareRow(shareId)).toBeUndefined();
        const pv = await pool.query(`SELECT 1 FROM conversation_share_previews WHERE session_id = $1`, [sid]);
        expect(pv.rowCount).toBe(0);
    });

    it('① 미리보기 CHECK — org 조합 강제, 세션당 한 건', async () => {
        const owner = await user('pv');
        const sid = await session(owner);
        const insert = (vis: string, o: string | null) => pool.query(
            `INSERT INTO conversation_share_previews (preview_id, session_id, owner_user_id, visibility, org_id, snapshot, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW() + INTERVAL '15 minutes')`,
            [randomUUID(), sid, owner, vis, o, SNAP],
        );
        await expect(insert('org', null)).rejects.toMatchObject({ code: '23514' });
        await expect(insert('private', null)).resolves.toBeDefined();
        await expect(insert('private', null)).rejects.toMatchObject({ code: '23505' });
    });

    it('② 소유자 탈퇴 → private·org/token NULL·revision+1, system 감사 1행', async () => {
        const { owner, orgId, shareId } = await orgShareFixture();
        await pool.query(`DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2`, [orgId, owner]);

        expect(await shareRow(shareId)).toEqual({ visibility: 'private', org_id: null, share_token: null, revision: '2' });
        const a = await audits(shareId);
        expect(a).toHaveLength(1);
        expect(a[0]).toMatchObject({ action: 'conversation_share.update', user_id: null });
        expect(a[0].details).toEqual({
            scopeBefore: 'org', scopeAfter: 'private', orgId, revision: 2, result: 'changed',
            reason: 'owner_membership_removed', removedUserId: owner,
        });
    });

    it('② 열람자 탈퇴는 공유 행을 바꾸지 않는다(차단은 조회 때 멤버십 검사)', async () => {
        const { viewer, orgId, shareId } = await orgShareFixture();
        await pool.query(`DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2`, [orgId, viewer]);
        expect(await shareRow(shareId)).toMatchObject({ visibility: 'org', org_id: orgId, revision: '1' });
        expect(await audits(shareId)).toHaveLength(0);
    });

    it('② 소유자 탈퇴 시 그 조직 대상 미리보기도 지운다', async () => {
        const { owner, orgId } = await orgShareFixture();
        const sid = await session(owner);
        await pool.query(
            `INSERT INTO conversation_share_previews (preview_id, session_id, owner_user_id, visibility, org_id, snapshot, expires_at)
             VALUES ($1, $2, $3, 'org', $4, $5::jsonb, NOW() + INTERVAL '15 minutes')`,
            [randomUUID(), sid, owner, orgId, SNAP],
        );
        await pool.query(`DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2`, [orgId, owner]);
        const pv = await pool.query(`SELECT 1 FROM conversation_share_previews WHERE session_id = $1`, [sid]);
        expect(pv.rowCount).toBe(0);
    });

    it('③ 조직 삭제 → private 전환, 감사는 organization_deleted 1행뿐(멤버 cascade 중복 없음)', async () => {
        const { orgId, shareId } = await orgShareFixture();
        await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);

        expect(await shareRow(shareId)).toEqual({ visibility: 'private', org_id: null, share_token: null, revision: '2' });
        const a = await audits(shareId);
        expect(a).toHaveLength(1);
        expect(a[0]).toMatchObject({ action: 'conversation_share.update', user_id: null });
        expect(a[0].details).toMatchObject({ scopeBefore: 'org', scopeAfter: 'private', orgId, reason: 'organization_deleted' });
        const m = await pool.query(`SELECT 1 FROM organization_members WHERE org_id = $1`, [orgId]);
        expect(m.rowCount).toBe(0);
    });

    it('④ 멤버 PK 변경(다른 조직·다른 사용자로)은 이전 자격 제거로 본다', async () => {
        const f1 = await orgShareFixture();
        const other = await org('other');
        await pool.query(`UPDATE organization_members SET org_id = $1 WHERE org_id = $2 AND user_id = $3`, [other, f1.orgId, f1.owner]);
        expect(await shareRow(f1.shareId)).toMatchObject({ visibility: 'private', org_id: null });
        expect((await audits(f1.shareId))[0].details).toMatchObject({ reason: 'owner_membership_removed', removedUserId: f1.owner });

        const f2 = await orgShareFixture();
        const someone = await user('someone');
        await pool.query(`UPDATE organization_members SET user_id = $1 WHERE org_id = $2 AND user_id = $3`, [someone, f2.orgId, f2.owner]);
        expect(await shareRow(f2.shareId)).toMatchObject({ visibility: 'private', org_id: null });
    });

    it('④ 역할만 바꾸면 영향 없다', async () => {
        const { owner, orgId, shareId } = await orgShareFixture();
        await pool.query(`UPDATE organization_members SET role = 'member' WHERE org_id = $1 AND user_id = $2`, [orgId, owner]);
        expect(await shareRow(shareId)).toMatchObject({ visibility: 'org', org_id: orgId, revision: '1' });
        expect(await audits(shareId)).toHaveLength(0);
    });

    it('⑤ 재가입해도 private 유지', async () => {
        const { owner, orgId, shareId } = await orgShareFixture();
        await pool.query(`DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2`, [orgId, owner]);
        await member(orgId, owner, 'owner');
        expect(await shareRow(shareId)).toMatchObject({ visibility: 'private', org_id: null });
    });

    it('⑥ 사용자 삭제 → 공유 CASCADE, 오류 없음', async () => {
        const { owner, shareId } = await orgShareFixture();
        await pool.query(`DELETE FROM users WHERE id = $1`, [owner]);
        expect(await shareRow(shareId)).toBeUndefined();
    });

    it('⑦ 롤백 — 모든 공유를 private 로 막고 행·snapshot 은 보존, 198 재적용으로 trigger 복구', async () => {
        const { owner, orgId, shareId } = await orgShareFixture();
        const linkShare = await share(await session(owner), owner, 'link', null, 'tok-rb');
        try {
            await pool.query(ROLLBACK);
            for (const id of [shareId, linkShare]) {
                expect(await shareRow(id)).toMatchObject({ visibility: 'private', org_id: null, share_token: null });
            }
            const snap = await pool.query(`SELECT snapshot FROM conversation_shares WHERE share_id = $1`, [shareId]);
            expect(snap.rows[0].snapshot).toEqual(JSON.parse(SNAP));
            const pv = await pool.query(`SELECT count(*)::int AS n FROM conversation_share_previews`);
            expect(pv.rows[0].n).toBe(0);
        } finally {
            await pool.query(FORWARD);
        }
        // trigger 복구 확인 — 새 org 공유가 소유자 탈퇴로 다시 private 가 된다
        const again = await share(await session(owner), owner, 'org', orgId);
        await pool.query(`DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2`, [orgId, owner]);
        expect(await shareRow(again)).toMatchObject({ visibility: 'private' });
    });
});
