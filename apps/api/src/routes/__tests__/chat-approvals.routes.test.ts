/**
 * 채팅 도구 승인 REST(W3 S3) — 대기 목록·승인·거절이 메모리 레지스트리의 대기를 실제로 해소하는지,
 * 소유자가 아니면 403(인가 거부 감사 포함), 없는 id 는 404. 승인 id 는 `apv_chat:<chatId>_…` 처럼 콜론을 담는다.
 */
import express from 'express';
import request from 'supertest';

const auditSecurityEvent = jest.fn(async (_e: unknown) => undefined);
jest.mock('../../security/security-audit', () => ({ auditSecurityEvent: (e: unknown) => auditSecurityEvent(e) }));
// 인증 대역 — 헤더의 사용자로 로그인한 것처럼, 헤더가 없으면 401
jest.mock('../../auth', () => ({
    requireAuth: (req: { header: (n: string) => string | undefined; user?: unknown }, res: { status: (c: number) => { json: (b: unknown) => void } }, next: () => void) => {
        const id = req.header('x-test-user');
        if (!id) { res.status(401).json({ success: false }); return; }
        req.user = { id, role: 'user' };
        next();
    },
}));

import { chatApprovalsRouter } from '../chat-approvals.routes';
import { errorHandler } from '../../utils/error-handler';
import { getChatApprovalRegistry, chatApprovalKey } from '../../services/chat-service/chat-approval';
import type { ApprovalResult } from '../../services/task-sandbox/approval-gate';

const app = express().use(express.json()).use('/api/chat', chatApprovalsRouter).use(errorHandler);

/** 채팅 도구 하나를 승인 대기에 올리고 그 id 와 결정 promise 를 돌려준다. */
async function pendingCall(owner = 'owner', chatId = 'c1'): Promise<{ approvalId: string; decided: Promise<ApprovalResult>; abort: AbortController }> {
    const abort = new AbortController();
    let approvalId = '';
    const decided = getChatApprovalRegistry().request(
        { taskId: chatApprovalKey(chatId), userId: owner, toolName: 'write_file', args: { path: 'a.txt', api_key: 'sk-secret' } },
        { timeoutMs: 60_000, signal: abort.signal, onPending: (p) => { approvalId = p.approvalId; } },
    );
    await Promise.resolve();
    return { approvalId, decided, abort };
}

beforeEach(() => auditSecurityEvent.mockClear());

describe('GET /api/chat/approvals/pending', () => {
    it('본인 대기만 — 인자는 가린 사본, 다른 사용자에게는 보이지 않는다', async () => {
        const { approvalId, abort } = await pendingCall();
        expect(approvalId).toMatch(/^apv_chat:c1_/);
        const res = await request(app).get('/api/chat/approvals/pending').set('x-test-user', 'owner');
        expect(res.status).toBe(200);
        const mine = res.body.data.pending.find((p: { approvalId: string }) => p.approvalId === approvalId);
        expect(mine).toMatchObject({ toolName: 'write_file', userId: 'owner' });
        expect(JSON.stringify(mine.args)).not.toContain('sk-secret');
        const other = await request(app).get('/api/chat/approvals/pending').set('x-test-user', 'intruder');
        expect(other.body.data.pending).toEqual([]);
        abort.abort();
    });

    it('로그인하지 않으면 401', async () => {
        expect((await request(app).get('/api/chat/approvals/pending')).status).toBe(401);
    });
});

describe('POST /api/chat/approvals/:approvalId/approve|reject', () => {
    it('소유자의 승인은 콜론이 든 id 로도 대기를 approved 로 해소한다', async () => {
        const { approvalId, decided } = await pendingCall();
        const res = await request(app).post(`/api/chat/approvals/${approvalId}/approve`).set('x-test-user', 'owner');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ ok: true });
        await expect(decided).resolves.toMatchObject({ decision: 'approved' });
    });

    it('소유자의 거절은 사유와 함께 대기를 rejected(user) 로 해소한다', async () => {
        const { approvalId, decided } = await pendingCall();
        const res = await request(app).post(`/api/chat/approvals/${approvalId}/reject`).set('x-test-user', 'owner').send({ reason: '  위험해 보임  ' });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ ok: true });
        await expect(decided).resolves.toMatchObject({ decision: 'rejected', reason: 'user', text: '위험해 보임' });
    });

    it('다른 사용자는 403 — 대기는 그대로이고 인가 거부가 감사에 남는다', async () => {
        const { approvalId, abort } = await pendingCall();
        for (const d of ['approve', 'reject']) {
            const res = await request(app).post(`/api/chat/approvals/${approvalId}/${d}`).set('x-test-user', 'intruder');
            expect(res.status).toBe(403);
        }
        expect(auditSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'security.authz_denied', userId: 'intruder' }));
        const still = await request(app).get('/api/chat/approvals/pending').set('x-test-user', 'owner');
        expect(still.body.data.pending.map((p: { approvalId: string }) => p.approvalId)).toContain(approvalId);
        abort.abort();
    });

    it('없는 id 는 404', async () => {
        for (const d of ['approve', 'reject']) {
            const res = await request(app).post(`/api/chat/approvals/apv_chat:nope_0/${d}`).set('x-test-user', 'owner');
            expect(res.status).toBe(404);
        }
    });
});
