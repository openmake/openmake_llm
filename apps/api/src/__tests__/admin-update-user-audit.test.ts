/**
 * PUT /api/admin/users/:id — 감사 기록 회귀 테스트.
 *
 * 무DB — user-manager·AuditService 는 mock, auth 미들웨어는 관리자 주입 mock 으로 우회.
 * 검증 대상: 역할·활성 여부·비밀번호가 "실제로 바뀐" 필드마다 감사 기록이 남는지,
 * 비밀번호 값이 기록에 들어가지 않는지, 바뀌지 않은 필드는 기록되지 않는지.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../auth', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'admin-1', userId: 'admin-1', email: 'admin@example.com', role: 'admin' };
        next();
    },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const getUserById = jest.fn();
const updateUser = jest.fn();
jest.mock('../data/user-manager', () => ({
    getUserManager: () => ({ getUserById, updateUser }),
    USER_ROLES: { ADMIN: 'admin', USER: 'user' },
    isUserRole: (r: unknown) => r === 'admin' || r === 'user',
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../services/AuthService', () => ({
    validatePasswordComplexity: () => ({ valid: true, errors: [] }),
}));
jest.mock('../controllers/admin-alerts.controller', () => ({
    listAlertHistory: jest.fn(),
    exportAlertHistoryCsv: jest.fn(),
    getAlertStats: jest.fn(),
    getLlmPoolStats: jest.fn(),
    acknowledgeAlert: jest.fn(),
}));

const logAudit = jest.fn();
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit }) }));

import { createAdminController } from '../controllers/admin.controller';

const NEW_PASSWORD = 'Sup3r-Secret-Pw!';
const before = { id: 'u-1', email: 'target@example.com', role: 'user', is_active: true, created_at: '2026-01-01' };

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminController());
    return app;
}

/** 감사 기록은 응답 뒤 비동기로 남는다 — 대기열이 비워질 때까지 기다린다. */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

async function put(body: Record<string, unknown>, after: Record<string, unknown> = {}) {
    updateUser.mockResolvedValue({ ...before, ...after });
    const res = await request(makeApp()).put('/api/admin/users/u-1').send(body);
    await flush();
    return res;
}

describe('PUT /api/admin/users/:id 감사 기록', () => {
    beforeEach(() => {
        getUserById.mockReset().mockResolvedValue({ ...before });
        updateUser.mockReset();
        logAudit.mockReset().mockResolvedValue(undefined);
    });

    it('역할이 바뀌면 changeUserRole 과 같은 모양으로 user.role_changed 를 남긴다', async () => {
        await put({ role: 'admin' }, { role: 'admin' }).then((res) => expect(res.status).toBe(200));

        expect(logAudit).toHaveBeenCalledTimes(1);
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'user.role_changed',
            userId: 'admin-1',
            resourceType: 'user',
            resourceId: 'u-1',
            details: { newRole: 'admin', targetEmail: 'target@example.com' },
            actor: { email: 'admin@example.com', role: 'admin' },
        }));
    });

    it('활성 여부가 바뀌면 user.active_changed 를 남긴다', async () => {
        await put({ is_active: false }, { is_active: false });

        expect(logAudit).toHaveBeenCalledTimes(1);
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'user.active_changed',
            userId: 'admin-1',
            resourceType: 'user',
            resourceId: 'u-1',
            details: { isActive: false, targetEmail: 'target@example.com' },
        }));
    });

    it('비밀번호를 바꾸면 password.changed 를 남기되 값은 넣지 않는다', async () => {
        await put({ password: NEW_PASSWORD });

        expect(logAudit).toHaveBeenCalledTimes(1);
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'password.changed',
            userId: 'admin-1',
            resourceType: 'user',
            resourceId: 'u-1',
            details: { targetEmail: 'target@example.com' },
        }));
        expect(JSON.stringify(logAudit.mock.calls)).not.toContain(NEW_PASSWORD);
    });

    it('여러 필드가 함께 바뀌면 필드마다 한 건씩 남긴다', async () => {
        await put({ role: 'admin', is_active: false, password: NEW_PASSWORD }, { role: 'admin', is_active: false });

        expect(logAudit.mock.calls.map(([entry]) => entry.action).sort())
            .toEqual(['password.changed', 'user.active_changed', 'user.role_changed']);
    });

    it('보낸 값이 기존과 같으면 기록하지 않는다', async () => {
        await put({ role: 'user', is_active: true });

        expect(logAudit).not.toHaveBeenCalled();
    });

    it('이메일만 바꾸면 역할·활성·비밀번호 기록은 남지 않는다', async () => {
        await put({ email: 'renamed@example.com' }, { email: 'renamed@example.com' });

        expect(logAudit).not.toHaveBeenCalled();
    });

    it('대상 사용자가 없으면 404 이고 기록하지 않는다', async () => {
        getUserById.mockResolvedValue(null);
        updateUser.mockResolvedValue(null);
        const res = await request(makeApp()).put('/api/admin/users/u-1').send({ role: 'admin' });
        await flush();

        expect(res.status).toBe(404);
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('감사 기록이 실패해도 사용자 수정은 성공한다 (changeUserRole 과 같은 정책)', async () => {
        logAudit.mockRejectedValue(new Error('audit down'));
        const res = await put({ role: 'admin' }, { role: 'admin' });

        expect(res.status).toBe(200);
        expect(res.body.data.user.role).toBe('admin');
    });
});
