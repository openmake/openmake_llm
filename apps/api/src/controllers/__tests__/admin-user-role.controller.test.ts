/**
 * 관리자 사용자 관리 — 마지막 활성 관리자 보호(2026-11-07 점검)의 AppError 는 500 이 아니라 그 상태·메시지로 응답한다.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../auth', () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        (req as unknown as { user: unknown }).user = { userId: 'admin-1', email: 'admin@example.com', role: 'admin' };
        next();
    },
    requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    clearSessionsForUser: jest.fn(),
}));
const mockManager = { changeRole: jest.fn(), updateUser: jest.fn(), getUserById: jest.fn(), deleteUser: jest.fn() };
jest.mock('../../data/user-manager', () => ({
    ...jest.requireActual('../../data/user-manager'),
    getUserManager: () => mockManager,
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: jest.fn() }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }) }));
jest.mock('../../services/AuthService', () => ({ validatePasswordComplexity: () => ({ valid: true, errors: [] }) }));
jest.mock('../admin-alerts.controller', () => ({
    listAlertHistory: jest.fn(), exportAlertHistoryCsv: jest.fn(), getAlertStats: jest.fn(), getLlmPoolStats: jest.fn(), acknowledgeAlert: jest.fn(),
}));
jest.mock('../admin-conversations.controller', () => ({ getConversations: jest.fn(), getStats: jest.fn(), exportConversations: jest.fn() }));

import { createAdminController } from '../admin.controller';
import { AppError } from '../../utils/error-handler';
import { LAST_ADMIN_ERROR_CODE, LAST_ADMIN_ERROR_MESSAGE } from '../../data/last-admin-guard';

const app = express();
app.use(express.json());
app.use('/api/admin', createAdminController());

const lastAdminError = () => new AppError(LAST_ADMIN_ERROR_MESSAGE, 409, true, LAST_ADMIN_ERROR_CODE);

beforeEach(() => { Object.values(mockManager).forEach((m) => m.mockReset()); });

describe('admin 사용자 역할·상태 변경 — 마지막 관리자 보호', () => {
    test('PUT /users/:id/role — changeRole 이 AppError(409) 를 던지면 409 와 그 메시지', async () => {
        mockManager.changeRole.mockRejectedValue(lastAdminError());
        const res = await request(app).put('/api/admin/users/admin-1/role').send({ role: 'user' });
        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatchObject({ code: LAST_ADMIN_ERROR_CODE, message: LAST_ADMIN_ERROR_MESSAGE });
    });

    test('PUT /users/:id — updateUser 가 AppError(409) 를 던지면 409 와 그 메시지', async () => {
        mockManager.getUserById.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'admin', is_active: true });
        mockManager.updateUser.mockRejectedValue(lastAdminError());
        const res = await request(app).put('/api/admin/users/admin-1').send({ is_active: false });
        expect(res.status).toBe(409);
        expect(res.body.error).toMatchObject({ code: LAST_ADMIN_ERROR_CODE, message: LAST_ADMIN_ERROR_MESSAGE });
    });

    test('DELETE /users/:id — deleteUser 가 AppError(409) 를 던지면 409 와 그 메시지', async () => {
        mockManager.deleteUser.mockRejectedValue(lastAdminError());
        const res = await request(app).delete('/api/admin/users/admin-2');
        expect(res.status).toBe(409);
        expect(res.body.error).toMatchObject({ code: LAST_ADMIN_ERROR_CODE, message: LAST_ADMIN_ERROR_MESSAGE });
    });

    test('DELETE /users/:id — 존재하지 않는 사용자는 400 과 사실대로의 문구', async () => {
        mockManager.deleteUser.mockResolvedValue(false);
        const res = await request(app).delete('/api/admin/users/nope');
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('삭제할 수 없습니다 (존재하지 않는 사용자)');
    });

    test('DELETE /users/:id — AppError 가 아닌 오류는 종전대로 500', async () => {
        mockManager.deleteUser.mockRejectedValue(new Error('db down'));
        const res = await request(app).delete('/api/admin/users/admin-2');
        expect(res.status).toBe(500);
    });

    test('AppError 가 아닌 오류는 종전대로 500', async () => {
        mockManager.changeRole.mockRejectedValue(new Error('db down'));
        const res = await request(app).put('/api/admin/users/admin-1/role').send({ role: 'user' });
        expect(res.status).toBe(500);
    });
});
