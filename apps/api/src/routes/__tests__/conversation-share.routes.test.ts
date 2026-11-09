/**
 * 대화 공유 라우트 — 인증·입력 계약·오류 매핑·캐시 헤더. 인가 판정·DB 의미는 service(.db) 테스트가 본다.
 *  - 관리 경로: 비로그인 401, 비소유/없음 404, 잘못된 입력 400, draft 만료·경쟁 409, 빈 대화 422, 한도 413
 *  - 게시: { previewId, confirmed: true } 만 — 클라이언트 snapshot·owner·범위 override 거절
 *  - 조회: 거절 사유 구별 없는 404, 관리자도 우회 없음(서비스에 viewerId 만 넘긴다)
 *  - DB·감사 실패는 503 이고 본문을 내보내지 않는다
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

let user: { id: string; role: string } | null = { id: 'u1', role: 'user' };
jest.mock('../../auth', () => {
    const optionalAuth = (req: Request, _res: Response, next: NextFunction) => { if (user) (req as any).user = user; next(); };
    const requireAuth = (req: Request, res: Response, next: NextFunction) => {
        if (!user) { res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'x' } }); return; }
        (req as any).user = user;
        next();
    };
    return { requireAuth, optionalAuth };
});
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

const svc = { status: jest.fn(), preview: jest.fn(), publish: jest.fn(), revoke: jest.fn(), read: jest.fn() };
jest.mock('../../services/conversation-share/service', () => {
    const actual = jest.requireActual('../../services/conversation-share/service');
    return { ...actual, ConversationShareService: jest.fn().mockImplementation(() => svc) };
});

import { conversationShareRouter } from '../conversation-share.routes';
import { ConversationShareError } from '../../services/conversation-share/service';

const app = () => { const a = express(); a.use(express.json()); a.use('/api', conversationShareRouter); return a; };
const PREVIEW_ID = '0b7f0a0e-1111-4222-8333-944445555666';
const SHARE_ID = '1b7f0a0e-1111-4222-8333-944445555666';
const DOC = { schemaVersion: 1, title: 't', messages: [{ role: 'user', content: 'hi' }] };

beforeEach(() => { jest.clearAllMocks(); user = { id: 'u1', role: 'user' }; });

describe('관리 경로 인증·소유권', () => {
    it('비로그인은 401 이고 서비스를 부르지 않는다', async () => {
        user = null;
        const a = app();
        for (const r of [
            request(a).get('/api/sessions/s1/share'),
            request(a).post('/api/sessions/s1/share/preview').send({}),
            request(a).post('/api/sessions/s1/share').send({ previewId: PREVIEW_ID, confirmed: true }),
            request(a).delete('/api/sessions/s1/share'),
        ]) expect((await r).status).toBe(401);
        expect(Object.values(svc).every((f) => f.mock.calls.length === 0)).toBe(true);
    });

    it('비소유·없는 세션은 404, 관리자도 같은 소유권 검사(로그인 ID 만 넘긴다)', async () => {
        user = { id: 'admin-1', role: 'admin' };
        svc.status.mockRejectedValue(new ConversationShareError('NOT_FOUND'));
        const r = await request(app()).get('/api/sessions/s1/share');
        expect(r.status).toBe(404);
        expect(svc.status).toHaveBeenCalledWith('admin-1', 's1');
    });

    it('상태 응답은 서비스 결과 그대로 + no-store', async () => {
        const body = { share: null, capabilities: { canShare: true, allowedVisibilities: ['private'], organizations: [] } };
        svc.status.mockResolvedValue(body);
        const r = await request(app()).get('/api/sessions/s1/share');
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual(body);
        expect(r.headers['cache-control']).toBe('private, no-store');
    });
});

describe('미리보기 입력', () => {
    it('기본 private 로 넘기고 문서를 돌려준다', async () => {
        svc.preview.mockResolvedValue({ previewId: PREVIEW_ID, document: DOC });
        const r = await request(app()).post('/api/sessions/s1/share/preview').send({});
        expect(r.status).toBe(200);
        expect(svc.preview).toHaveBeenCalledWith('u1', 's1', {});
        expect(r.headers['cache-control']).toBe('private, no-store');
    });

    it.each([
        [{ visibility: 'public' }],
        [{ visibility: 'org' }],
        [{ visibility: 'link', orgId: 'o1' }],
        [{ visibility: 'private', snapshot: DOC }],
    ])('잘못된 입력 %j 은 400', async (body) => {
        const r = await request(app()).post('/api/sessions/s1/share/preview').send(body);
        expect(r.status).toBe(400);
        expect(svc.preview).not.toHaveBeenCalled();
    });

    it.each([
        ['EMPTY', 422, 'CONVERSATION_SHARE_EMPTY'],
        ['TOO_LARGE', 413, 'CONVERSATION_SHARE_TOO_LARGE'],
        ['NOT_FOUND', 404, 'NOT_FOUND'],
        ['INVALID', 400, 'BAD_REQUEST'],
    ] as const)('서비스 %s → %i (%s)', async (code, status, errCode) => {
        svc.preview.mockRejectedValue(new ConversationShareError(code));
        const r = await request(app()).post('/api/sessions/s1/share/preview').send({ visibility: 'org', orgId: 'forged' });
        expect(r.status).toBe(status);
        expect(r.body.error.code).toBe(errCode);
    });
});

describe('게시 입력', () => {
    it('confirmed:true 와 previewId 만 받아 서비스에 넘긴다', async () => {
        svc.publish.mockResolvedValue({ shareId: SHARE_ID, visibility: 'private', path: `/shared/conversation/${SHARE_ID}` });
        const r = await request(app()).post('/api/sessions/s1/share').send({ previewId: PREVIEW_ID, confirmed: true });
        expect(r.status).toBe(200);
        expect(svc.publish).toHaveBeenCalledWith('u1', 's1', PREVIEW_ID);
    });

    it.each([
        [{ previewId: PREVIEW_ID }],
        [{ previewId: PREVIEW_ID, confirmed: false }],
        [{ previewId: PREVIEW_ID, confirmed: 'true' }],
        [{ confirmed: true }],
        [{ previewId: PREVIEW_ID, confirmed: true, snapshot: DOC }],
        [{ previewId: PREVIEW_ID, confirmed: true, visibility: 'link' }],
        [{ previewId: PREVIEW_ID, confirmed: true, ownerUserId: 'u2' }],
    ])('확인 누락·override %j 은 400', async (body) => {
        const r = await request(app()).post('/api/sessions/s1/share').send(body);
        expect(r.status).toBe(400);
        expect(svc.publish).not.toHaveBeenCalled();
    });

    it('만료·타인 draft·revision 충돌은 409 PREVIEW_STALE', async () => {
        svc.publish.mockRejectedValue(new ConversationShareError('PREVIEW_STALE'));
        const r = await request(app()).post('/api/sessions/s1/share').send({ previewId: PREVIEW_ID, confirmed: true });
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('CONVERSATION_SHARE_PREVIEW_STALE');
    });

    it('DB·감사 실패는 503 이고 내부 메시지를 싣지 않는다', async () => {
        svc.publish.mockRejectedValue(new Error('audit insert failed: secret detail'));
        const r = await request(app()).post('/api/sessions/s1/share').send({ previewId: PREVIEW_ID, confirmed: true });
        expect(r.status).toBe(503);
        expect(JSON.stringify(r.body)).not.toContain('secret detail');
    });
});

describe('해제', () => {
    it('멱등 결과를 그대로 돌려준다', async () => {
        svc.revoke.mockResolvedValue({ unshared: false });
        const r = await request(app()).delete('/api/sessions/s1/share');
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual({ unshared: false });
    });
});

describe('공유본 조회', () => {
    const view = { shareId: SHARE_ID, visibility: 'link', capturedAt: 'c', updatedAt: 'u', document: DOC };

    it('허용 — 문서와 no-store·no-referrer·noindex 헤더', async () => {
        user = null;
        svc.read.mockResolvedValue({ allowed: true, view });
        const r = await request(app()).get(`/api/shared-conversations/${SHARE_ID}?token=tok`);
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual(view);
        expect(svc.read).toHaveBeenCalledWith(null, SHARE_ID, 'tok');
        expect(r.headers['cache-control']).toBe('private, no-store');
        expect(r.headers['referrer-policy']).toBe('no-referrer');
        expect(r.headers['x-robots-tag']).toBe('noindex, nofollow');
    });

    it('거절은 사유와 무관하게 같은 404 본문', async () => {
        user = { id: 'admin-1', role: 'admin' };
        svc.read.mockResolvedValue({ allowed: false });
        const a = await request(app()).get(`/api/shared-conversations/${SHARE_ID}`);
        user = null;
        const b = await request(app()).get('/api/shared-conversations/not-a-uuid?token=x');
        expect(a.status).toBe(404);
        expect(b.status).toBe(404);
        expect(a.body.error).toEqual(b.body.error);
        expect(svc.read).toHaveBeenNthCalledWith(1, 'admin-1', SHARE_ID, undefined);
    });

    it('배열 token 은 무시한다(문자열만)', async () => {
        svc.read.mockResolvedValue({ allowed: false });
        await request(app()).get(`/api/shared-conversations/${SHARE_ID}?token=a&token=b`);
        expect(svc.read).toHaveBeenCalledWith('u1', SHARE_ID, undefined);
    });

    it('DB·감사 실패는 503, 본문 없음', async () => {
        svc.read.mockRejectedValue(new Error('db down'));
        const r = await request(app()).get(`/api/shared-conversations/${SHARE_ID}`);
        expect(r.status).toBe(503);
        expect(r.body.data).toBeUndefined();
    });
});
