/**
 * ConversationShareService — 실제 Postgres 흐름·경쟁 검증(198). TEST_DATABASE_URL 이 없으면 skip.
 * 테스트 DB 의 실제 표에 고유 접두사 fixture 를 만들고 끝나면 지운다.
 *  - 미리보기 = 게시 snapshot, 미리보기 이후 새 메시지·원본 변경 비포함
 *  - 소유권·빈 대화·한도·만료/타인/다른 세션 draft·revision 409
 *  - 범위별 조회 인가(org 멤버십 재검사·탈퇴 즉시 차단), link 토큰 유지/재발급, 해제 후 옛 URL 차단
 *  - 감사 create/update/revoke/view(허용·거절), 감사 실패 시 rollback
 *  - 경쟁: 같은 미리보기 동시 게시, org 게시 ↔ 소유자 탈퇴, 조회 잠금 ↔ 열람자 탈퇴
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ConversationShareRepository, ShareTx } from '../../../data/repositories/conversation-share-repository';
import { ConversationShareService, ConversationShareError } from '../service';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const FORWARD = fs.readFileSync(path.resolve(__dirname, '../../../../../../db/migrations/198_conversation_shares.sql'), 'utf8');
const P = `css-${randomUUID().slice(0, 8)}`;

describeOrSkip('ConversationShareService (테스트 DB 실제 표)', () => {
    let pool: Pool;
    let svc: ConversationShareService;
    const users: string[] = [];
    const orgs: string[] = [];

    async function user(name: string): Promise<string> {
        const id = `${P}-u-${name}-${randomUUID().slice(0, 6)}`;
        await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [id]);
        users.push(id);
        return id;
    }
    async function org(name: string, ...members: string[]): Promise<string> {
        const id = `${P}-o-${name}-${randomUUID().slice(0, 6)}`;
        await pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $1)`, [id, `org ${name}`]);
        orgs.push(id);
        for (const m of members) await pool.query(`INSERT INTO organization_members (org_id, user_id) VALUES ($1, $2)`, [id, m]);
        return id;
    }
    async function leave(orgId: string, userId: string): Promise<void> {
        await pool.query(`DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2`, [orgId, userId]);
    }
    async function session(ownerId: string | null, msgs: Array<[string, string]> = [['user', '질문'], ['assistant', '답변']]): Promise<string> {
        const id = `${P}-s-${randomUUID().slice(0, 8)}`;
        await pool.query(`INSERT INTO conversation_sessions (id, user_id, title) VALUES ($1, $2, '제목')`, [id, ownerId]);
        for (const [role, content] of msgs) await addMsg(id, role, content);
        return id;
    }
    async function addMsg(sessionId: string, role: string, content: string, extra: { thinking?: string } = {}): Promise<void> {
        await pool.query(
            `INSERT INTO conversation_messages (session_id, role, content, thinking, model) VALUES ($1, $2, $3, $4, 'hidden-model')`,
            [sessionId, role, content, extra.thinking ?? null],
        );
    }
    async function audits(shareId: string): Promise<Array<{ action: string; user_id: string | null; details: Record<string, unknown> }>> {
        const r = await pool.query(
            `SELECT action, user_id, details FROM audit_logs WHERE resource_type = 'conversation_share' AND resource_id = $1 ORDER BY id`,
            [shareId],
        );
        return r.rows;
    }
    async function publishNew(owner: string, sid: string, visibility: 'private' | 'authenticated' | 'link' | 'org' = 'private', orgId?: string) {
        const pv = await svc.preview(owner, sid, { visibility, orgId });
        return svc.publish(owner, sid, pv.previewId);
    }
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ConversationShareError ? e.code : `other:${String(e)}`));

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 6 });
        await pool.query(FORWARD);
        svc = new ConversationShareService(new ConversationShareRepository(pool));
    });

    afterEach(() => jest.restoreAllMocks());

    afterAll(async () => {
        if (pool) {
            await pool.query(`DELETE FROM organizations WHERE id = ANY($1::text[])`, [orgs]);
            await pool.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [users]);
            await pool.end();
        }
    });

    it('미리보기 문서를 그대로 게시하고, 미리보기 이후 메시지·원본 변경은 공유본에 없다', async () => {
        const owner = await user('a');
        const sid = await session(owner);
        await addMsg(sid, 'assistant', '두 번째', { thinking: '숨은 사고' });
        await addMsg(sid, 'system', '시스템');
        const pv = await svc.preview(owner, sid, { visibility: 'private' });
        expect(pv.document).toEqual({
            schemaVersion: 1, title: '제목',
            messages: [{ role: 'user', content: '질문' }, { role: 'assistant', content: '답변' }, { role: 'assistant', content: '두 번째' }],
        });
        expect(pv.baseRevision).toBe(0);
        expect(new Date(pv.expiresAt).getTime() - new Date(pv.capturedAt).getTime()).toBe(15 * 60 * 1000);

        await addMsg(sid, 'user', '미리보기 이후');
        const st = await svc.publish(owner, sid, pv.previewId);
        expect(st).toMatchObject({ visibility: 'private', orgId: null, revision: 1, path: `/shared/conversation/${st.shareId}` });

        await addMsg(sid, 'user', '게시 이후');
        await pool.query(`UPDATE conversation_sessions SET title = '바뀐 제목' WHERE id = $1`, [sid]);
        const r = await svc.read(owner, st.shareId, undefined);
        expect(r.allowed && r.view.document).toEqual(pv.document);
        const text = JSON.stringify(r);
        for (const hidden of ['미리보기 이후', '게시 이후', '바뀐 제목', '숨은 사고', 'hidden-model', '시스템', sid]) expect(text).not.toContain(hidden);
        // 미리보기는 게시와 함께 지워진다 — 같은 ID 재사용 불가
        expect(await code(svc.publish(owner, sid, pv.previewId))).toBe('PREVIEW_STALE');
    });

    it('소유권 — 타인·익명 세션·없는 세션은 NOT_FOUND', async () => {
        const owner = await user('own');
        const other = await user('oth');
        const sid = await session(owner);
        const anon = await session(null);
        expect(await code(svc.preview(other, sid, {}))).toBe('NOT_FOUND');
        expect(await code(svc.preview(owner, anon, {}))).toBe('NOT_FOUND');
        expect(await code(svc.preview(owner, `${P}-missing`, {}))).toBe('NOT_FOUND');
        expect(await code(svc.status(other, sid))).toBe('NOT_FOUND');
        expect(await code(svc.revoke(other, sid))).toBe('NOT_FOUND');
        const pv = await svc.preview(owner, sid, {});
        expect(await code(svc.publish(other, sid, pv.previewId))).toBe('NOT_FOUND');
    });

    it('빈 대화 EMPTY, 500개 초과·1MiB 초과 TOO_LARGE(부분 공유 없음)', async () => {
        const owner = await user('lim');
        expect(await code(svc.preview(owner, await session(owner, [['system', 's']]), {}))).toBe('EMPTY');
        const many = await session(owner, []);
        await pool.query(
            `INSERT INTO conversation_messages (session_id, role, content) SELECT $1, 'user', 'm' || g FROM generate_series(1, 501) g`, [many]);
        expect(await code(svc.preview(owner, many, {}))).toBe('TOO_LARGE');
        const big = await session(owner, [['user', 'x'.repeat(1024 * 1024)]]);
        expect(await code(svc.preview(owner, big, {}))).toBe('TOO_LARGE');
        const ok = await session(owner, []);
        await pool.query(
            `INSERT INTO conversation_messages (session_id, role, content) SELECT $1, 'user', 'm' || g FROM generate_series(1, 500) g`, [ok]);
        expect((await svc.preview(owner, ok, {})).document.messages).toHaveLength(500);
    });

    it('draft 거절 — 만료·다른 세션·교체된 이전 미리보기는 PREVIEW_STALE', async () => {
        const owner = await user('dr');
        const s1 = await session(owner);
        const s2 = await session(owner);
        const p1 = await svc.preview(owner, s1, {});
        expect(await code(svc.publish(owner, s2, p1.previewId))).toBe('PREVIEW_STALE');
        await pool.query(`UPDATE conversation_share_previews SET expires_at = NOW() - INTERVAL '1 second' WHERE preview_id = $1`, [p1.previewId]);
        expect(await code(svc.publish(owner, s1, p1.previewId))).toBe('PREVIEW_STALE');
        const p2 = await svc.preview(owner, s1, {});
        const p3 = await svc.preview(owner, s1, { visibility: 'link' });
        expect(await code(svc.publish(owner, s1, p2.previewId))).toBe('PREVIEW_STALE');
        expect((await svc.publish(owner, s1, p3.previewId)).visibility).toBe('link');
    });

    it('revision 충돌 — 미리보기 뒤 trigger 가 공유를 바꾸면 409(PREVIEW_STALE)', async () => {
        const owner = await user('rev');
        const orgId = await org('rev', owner);
        const sid = await session(owner);
        await publishNew(owner, sid, 'org', orgId);
        const pv = await svc.preview(owner, sid, { visibility: 'link' });
        expect(pv.baseRevision).toBe(1);
        await leave(orgId, owner);
        expect(await code(svc.publish(owner, sid, pv.previewId))).toBe('PREVIEW_STALE');
    });

    it('범위 인가 — authenticated·link·org, 관리자 우회 없음', async () => {
        const a = await user('A');
        const b = await user('B');
        const c = await user('C');
        await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [c]);
        const orgId = await org('ab', a, b);
        await org('cd', a, c);
        const sid = await session(a);

        const authShare = await publishNew(a, sid, 'authenticated');
        expect((await svc.read(c, authShare.shareId, undefined)).allowed).toBe(true);
        expect((await svc.read(null, authShare.shareId, undefined)).allowed).toBe(false);

        const orgShare = await publishNew(a, sid, 'org', orgId);
        expect(orgShare.shareId).toBe(authShare.shareId);
        expect(orgShare.revision).toBe(2);
        expect((await svc.read(b, orgShare.shareId, undefined)).allowed).toBe(true);
        expect((await svc.read(c, orgShare.shareId, undefined)).allowed).toBe(false); // 관리자·다른 조직 동료
        expect((await svc.read(null, orgShare.shareId, 'anything')).allowed).toBe(false);
        await leave(orgId, b);
        expect((await svc.read(b, orgShare.shareId, undefined)).allowed).toBe(false);

        const link = await publishNew(a, sid, 'link');
        const token = new URL(link.path, 'http://x').searchParams.get('token')!;
        expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
        expect((await svc.read(null, link.shareId, token)).allowed).toBe(true);
        expect((await svc.read(null, link.shareId, `${token}x`)).allowed).toBe(false);
        expect((await svc.read(c, link.shareId, undefined)).allowed).toBe(false);
        const relink = await publishNew(a, sid, 'link');
        expect(relink.path).toBe(link.path); // link→link 토큰 유지
        await publishNew(a, sid, 'private');
        const link2 = await publishNew(a, sid, 'link');
        expect(link2.path).not.toBe(link.path); // 다른 범위→link 새 토큰
        expect((await svc.read(null, link2.shareId, token)).allowed).toBe(false);
    });

    it('org 게시 — 미리보기·게시 모두 소유자의 현재 멤버십을 확인, 위조 org 는 NOT_FOUND', async () => {
        const a = await user('oa');
        const orgId = await org('oa', a);
        const foreign = await org('foreign');
        const sid = await session(a);
        expect(await code(svc.preview(a, sid, { visibility: 'org', orgId: foreign }))).toBe('NOT_FOUND');
        expect(await code(svc.preview(a, sid, { visibility: 'org', orgId: `${P}-nope` }))).toBe('NOT_FOUND');
        expect(await code(svc.preview(a, sid, { visibility: 'org' }))).toBe('INVALID');
        expect(await code(svc.preview(a, sid, { visibility: 'link', orgId }))).toBe('INVALID');
        const pv = await svc.preview(a, sid, { visibility: 'org', orgId });
        await leave(orgId, a);
        expect(await code(svc.publish(a, sid, pv.previewId))).toBe('NOT_FOUND');
        const st = await svc.status(a, sid);
        expect(st.share).toBeNull();
        expect(st.capabilities).toEqual({ canShare: true, allowedVisibilities: ['private', 'authenticated', 'link'], organizations: [] });
    });

    it('status — 서버가 현재 멤버십으로 조직 선택지를 계산한다', async () => {
        const a = await user('st');
        const o1 = await org('st1', a);
        const sid = await session(a);
        const st = await svc.status(a, sid);
        expect(st.capabilities.allowedVisibilities).toContain('org');
        expect(st.capabilities.organizations).toEqual([{ orgId: o1, name: 'org st1' }]);
    });

    it('해제 — 공유·draft 삭제, 옛 URL 404, 다시 게시하면 새 share_id', async () => {
        const a = await user('rv');
        const sid = await session(a);
        const first = await publishNew(a, sid, 'authenticated');
        await svc.preview(a, sid, {});
        expect(await svc.revoke(a, sid)).toEqual({ unshared: true });
        expect(await svc.revoke(a, sid)).toEqual({ unshared: false });
        const pv = await pool.query(`SELECT 1 FROM conversation_share_previews WHERE session_id = $1`, [sid]);
        expect(pv.rowCount).toBe(0);
        expect((await svc.read(a, first.shareId, undefined)).allowed).toBe(false);
        const again = await publishNew(a, sid, 'authenticated');
        expect(again.shareId).not.toBe(first.shareId);
        expect(again.revision).toBe(1);
    });

    it('감사 — create·update·revoke·view(허용·거절), 본문·토큰 없음', async () => {
        const a = await user('au');
        const b = await user('au-b');
        const sid = await session(a, [['user', '비밀 본문']]);
        const s1 = await publishNew(a, sid, 'link');
        const token = new URL(s1.path, 'http://x').searchParams.get('token')!;
        await publishNew(a, sid, 'private');
        await svc.read(a, s1.shareId, undefined);
        await svc.read(b, s1.shareId, undefined);
        await svc.revoke(a, sid);
        const rows = await audits(s1.shareId);
        expect(rows.map((r) => [r.action, r.user_id, r.details.result])).toEqual([
            ['conversation_share.create', a, 'success'],
            ['conversation_share.update', a, 'success'],
            ['conversation_share.view', a, 'allowed'],
            ['conversation_share.view', b, 'denied'],
            ['conversation_share.revoke', a, 'success'],
        ]);
        expect(rows[1].details).toEqual({ scopeBefore: 'link', scopeAfter: 'private', orgId: null, revision: 2, result: 'success' });
        expect(rows[3].details).toMatchObject({ reason: 'not_owner' });
        const text = JSON.stringify(rows);
        expect(text).not.toContain('비밀 본문');
        expect(text).not.toContain(token);
        // 없는 공유 ID 조회도 거절 기록(본문 없음)
        const missing = randomUUID();
        expect((await svc.read(null, missing, undefined)).allowed).toBe(false);
        expect((await audits(missing)).map((r) => [r.action, r.details.result, r.details.reason])).toEqual([
            ['conversation_share.view', 'denied', 'not_found'],
        ]);
    });

    it('감사 INSERT 실패 — 게시·조회 전체 rollback, 본문 반환 없음', async () => {
        const a = await user('fail');
        const sid = await session(a);
        const pv = await svc.preview(a, sid, {});
        jest.spyOn(ShareTx.prototype, 'audit').mockRejectedValue(new Error('audit down'));
        await expect(svc.publish(a, sid, pv.previewId)).rejects.toThrow('audit down');
        const s = await pool.query(`SELECT 1 FROM conversation_shares WHERE session_id = $1`, [sid]);
        expect(s.rowCount).toBe(0);
        const kept = await pool.query(`SELECT 1 FROM conversation_share_previews WHERE preview_id = $1`, [pv.previewId]);
        expect(kept.rowCount).toBe(1);
        jest.restoreAllMocks();

        const st = await svc.publish(a, sid, pv.previewId);
        jest.spyOn(ShareTx.prototype, 'audit').mockRejectedValue(new Error('audit down'));
        await expect(svc.read(a, st.shareId, undefined)).rejects.toThrow('audit down');
    });

    it('경쟁 (d) — 같은 미리보기 동시 게시는 하나만 성공', async () => {
        const a = await user('race');
        const sid = await session(a);
        const pv = await svc.preview(a, sid, {});
        const results = await Promise.all([code(svc.publish(a, sid, pv.previewId)), code(svc.publish(a, sid, pv.previewId))]);
        expect(results.sort()).toEqual(['PREVIEW_STALE', 'ok']);
        const r = await pool.query(`SELECT revision FROM conversation_shares WHERE session_id = $1`, [sid]);
        expect(r.rows).toEqual([{ revision: '1' }]);
    });

    it('경쟁 (a) — org 게시와 소유자 탈퇴 동시: 끝 상태에 탈퇴한 소유자의 org 공유는 없다', async () => {
        for (let i = 0; i < 3; i++) {
            const a = await user(`ra${i}`);
            const orgId = await org(`ra${i}`, a);
            const sid = await session(a);
            const pv = await svc.preview(a, sid, { visibility: 'org', orgId });
            await Promise.all([code(svc.publish(a, sid, pv.previewId)), leave(orgId, a)]);
            const r = await pool.query(`SELECT visibility, org_id FROM conversation_shares WHERE session_id = $1`, [sid]);
            expect(r.rows.filter((x) => x.visibility === 'org')).toEqual([]);
        }
    });

    it('경쟁 (b) — 조회가 멤버 행을 잠근 동안 탈퇴는 기다리고, 탈퇴 commit 뒤 조회는 거절', async () => {
        const a = await user('rb');
        const b = await user('rb-b');
        const orgId = await org('rb', a, b);
        const sid = await session(a);
        const st = await publishNew(a, sid, 'org', orgId);

        const reader = await pool.connect();
        try {
            await reader.query('BEGIN');
            const members = await new ShareTx(reader).lockMembers(orgId, [a, b, b]);
            expect([...members].sort()).toEqual([a, b].sort());
            let left = false;
            const leaving = leave(orgId, b).then(() => { left = true; });
            await new Promise((r) => setTimeout(r, 300));
            expect(left).toBe(false);
            await reader.query('COMMIT');
            await leaving;
            expect(left).toBe(true);
        } finally {
            reader.release();
        }
        expect((await svc.read(b, st.shareId, undefined)).allowed).toBe(false);
        expect((await svc.read(a, st.shareId, undefined)).allowed).toBe(true);
    });
});
