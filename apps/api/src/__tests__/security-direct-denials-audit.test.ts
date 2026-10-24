/**
 * 미들웨어 직접 거부 감사(#1475) — AppError 를 거치지 않고 res.status 로 바로 거부하는 지점도
 * security.authz_denied 를 한 번 남긴다. 응답 코드·본문은 그대로이고, 감사 저장이 실패해도
 * 응답은 바뀌지 않으며 unhandled rejection 이 생기지 않는다. 비밀값(토큰·키)은 감사에 들어가지 않는다.
 */
const logAudit = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }) }));
const verifyToken = jest.fn();
jest.mock('../auth/auth-core', () => ({ ...jest.requireActual('../auth/auth-core'), verifyToken: (...a: unknown[]) => verifyToken(...a) }));
const getUserById = jest.fn();
jest.mock('../data/user-manager', () => ({ ...jest.requireActual('../data/user-manager'), getUserManager: () => ({ getUserById: (...a: unknown[]) => getUserById(...a) }) }));
jest.mock('../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({}) }));

import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { requireAdmin, requireAuth } from '../auth/middleware';
import { requireScope } from '../middlewares/api-key-auth';

const SECRET_TOKEN = `tok_${Math.random().toString(36).slice(2)}`;
const SECRET_KEY = `omk_live_${Math.random().toString(16).slice(2)}`;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const asUser = (user: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    (req: Request, _res: Response, next: NextFunction) => { Object.assign(req, { user, ...extra }); next(); };
const ok = (_req: Request, res: Response) => { res.json({ ok: true }); };
const withoutMeta = (body: Record<string, unknown>) => { const { meta: _m, ...rest } = body; return rest; };

function app(): express.Express {
    const a = express();
    const admin = express.Router();
    admin.get('/stats', asUser({ id: 'u-1', role: 'user' }), requireAdmin, ok);
    admin.get('/ok', asUser({ id: 'a-1', role: 'admin' }), requireAdmin, ok);
    a.use('/api/admin', admin);
    a.get('/api/me', requireAuth, ok);
    a.post('/api/bridge', asUser({ id: 'u-2', role: 'user' }, { authMethod: 'api-key', apiKeyId: 'key-7', apiKeyRecord: { id: 'key-7', scopes: ['chat'] } }), requireScope('bridge' as never), ok);
    a.post('/api/bridge-jwt', asUser({ id: 'u-3', role: 'user' }), requireScope('bridge' as never), ok);
    return a;
}

let unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };
beforeAll(() => process.on('unhandledRejection', onUnhandled));
afterAll(() => process.off('unhandledRejection', onUnhandled));
beforeEach(() => { jest.clearAllMocks(); unhandled = []; logAudit.mockImplementation(async () => undefined); });

const auditCalls = () => logAudit.mock.calls.map((c) => c[0] as Record<string, unknown>);

describe('requireAdmin — 관리자 아님 403', () => {
    it('응답은 그대로이고 security.authz_denied 를 한 번 남긴다', async () => {
        const res = await request(app()).get('/api/admin/stats?token=' + SECRET_TOKEN);
        expect(res.status).toBe(403);
        expect(withoutMeta(res.body)).toEqual({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다' } });
        await flush();
        expect(auditCalls()).toEqual([expect.objectContaining({
            action: 'security.authz_denied', userId: 'u-1', resourceType: 'http', resourceId: 'GET /api/admin/stats',
            details: expect.objectContaining({ reason: 'admin_required', status: 403, actorId: 'u-1' }),
        })]);
        expect(JSON.stringify(auditCalls())).not.toContain(SECRET_TOKEN);
    });

    it('관리자는 통과하고 감사를 남기지 않는다', async () => {
        const res = await request(app()).get('/api/admin/ok');
        expect(res.status).toBe(200);
        await flush();
        expect(logAudit).not.toHaveBeenCalled();
    });
});

describe('requireAuth — 비활성 계정 403', () => {
    it('응답은 그대로이고 그 계정으로 security.authz_denied 를 한 번 남긴다(토큰은 넣지 않는다)', async () => {
        verifyToken.mockResolvedValue({ userId: 'u-9' });
        getUserById.mockResolvedValue({ id: 'u-9', role: 'user', is_active: false });
        const res = await request(app()).get('/api/me').set('Authorization', `Bearer ${SECRET_TOKEN}`);
        expect(res.status).toBe(403);
        expect(withoutMeta(res.body)).toEqual({ success: false, error: { code: 'FORBIDDEN', message: '비활성화된 계정입니다' } });
        await flush();
        expect(auditCalls()).toEqual([expect.objectContaining({
            action: 'security.authz_denied', userId: 'u-9', resourceType: 'http', resourceId: 'GET /api/me',
            details: expect.objectContaining({ reason: 'inactive_account', status: 403 }),
        })]);
        expect(JSON.stringify(auditCalls())).not.toContain(SECRET_TOKEN);
    });

    it('토큰 없음(401)은 직접 거부 감사 대상이 아니다', async () => {
        const res = await request(app()).get('/api/me');
        expect(res.status).toBe(401);
        await flush();
        expect(logAudit).not.toHaveBeenCalled();
    });
});

describe('requireScope — API key 스코프 부족 403', () => {
    it('응답은 그대로이고 키 id·요구 스코프만 남긴다(키 값은 넣지 않는다)', async () => {
        const res = await request(app()).post('/api/bridge').set('X-API-Key', SECRET_KEY);
        expect(res.status).toBe(403);
        expect(withoutMeta(res.body)).toEqual({ success: false, error: { code: 'FORBIDDEN', message: "이 API key 는 'bridge' 스코프가 없습니다. 해당 스코프의 키를 발급하세요." } });
        await flush();
        expect(auditCalls()).toEqual([expect.objectContaining({
            action: 'security.authz_denied', userId: 'u-2', resourceType: 'http', resourceId: 'POST /api/bridge',
            details: expect.objectContaining({ reason: 'api_key_scope', status: 403, scope: 'bridge', apiKeyId: 'key-7' }),
        })]);
        expect(JSON.stringify(auditCalls())).not.toContain(SECRET_KEY);
    });

    it('JWT 인증 요청은 스코프 무관 통과 — 감사 없음', async () => {
        const res = await request(app()).post('/api/bridge-jwt');
        expect(res.status).toBe(200);
        await flush();
        expect(logAudit).not.toHaveBeenCalled();
    });
});

describe('감사 저장 실패 — fail-open', () => {
    it('감사 기록이 실패해도 세 거부 응답은 그대로이고 unhandled rejection 이 없다', async () => {
        logAudit.mockImplementation(async () => { throw new Error('db down'); });
        verifyToken.mockResolvedValue({ userId: 'u-9' });
        getUserById.mockResolvedValue({ id: 'u-9', role: 'user', is_active: false });
        const a = app();
        const r1 = await request(a).get('/api/admin/stats');
        const r2 = await request(a).get('/api/me').set('Authorization', `Bearer ${SECRET_TOKEN}`);
        const r3 = await request(a).post('/api/bridge').set('X-API-Key', SECRET_KEY);
        await flush();
        expect([r1.status, r2.status, r3.status]).toEqual([403, 403, 403]);
        expect([r1.body.error.code, r2.body.error.code, r3.body.error.code]).toEqual(['FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN']);
        expect(logAudit).toHaveBeenCalledTimes(3);
        expect(unhandled).toEqual([]);
    });
});
