/**
 * admin-system-settings.routes — admin 전용 운영 설정 API 테스트.
 *
 * 무DB — service/audit 은 mock, auth 미들웨어는 role 주입 mock 으로 우회.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

let currentRole: 'admin' | 'user' = 'admin';

jest.mock('../../auth', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'test-admin', userId: 'test-admin', role: currentRole };
        next();
    },
    requireAdmin: (req: Request & { user?: { role?: string } }, res: Response, next: NextFunction) => {
        if (req.user?.role === 'admin') next();
        else res.status(403).json({ success: false, error: 'FORBIDDEN' });
    },
}));

const mockService = {
    describe: jest.fn().mockReturnValue([
        { key: 'GOOGLE_CSE_ID', group: 'search', secret: false, requiresRestart: false, source: 'env', isSet: true, value: 'cse' },
        { key: 'GOOGLE_API_KEY', group: 'search', secret: true, requiresRestart: false, source: 'db', isSet: true },
    ]),
    update: jest.fn().mockResolvedValue({ requiresRestart: ['LLM_BASE_URL'] }),
    reset: jest.fn().mockResolvedValue(true),
};
jest.mock('../../services/system-settings-service', () => ({
    getSystemSettingsService: () => mockService,
}));

const logAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/AuditService', () => ({
    getAuditService: () => ({ logAudit }),
}));

import { adminSystemSettingsRouter } from '../../routes/admin-system-settings.routes';

describe('admin-system-settings.routes', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/admin', adminSystemSettingsRouter);
    });

    beforeEach(() => {
        currentRole = 'admin';
        jest.clearAllMocks();
    });

    test('GET — 설정 뷰 반환 (시크릿은 isSet 만)', async () => {
        const r = await request(app).get('/api/admin/system-settings');
        expect(r.status).toBe(200);
        expect(r.body.data.settings).toHaveLength(2);
        const secret = r.body.data.settings.find((s: { key: string }) => s.key === 'GOOGLE_API_KEY');
        expect(secret.value).toBeUndefined();
    });

    test('GET — 일반 사용자 403', async () => {
        currentRole = 'user';
        const r = await request(app).get('/api/admin/system-settings');
        expect(r.status).toBe(403);
        expect(mockService.describe).not.toHaveBeenCalled();
    });

    test('PUT — 정상 저장 시 검증된 값으로 update 호출 + audit(키 목록만)', async () => {
        const r = await request(app)
            .put('/api/admin/system-settings')
            .send({ entries: { GOOGLE_CSE_ID: '  my-cse-id  ', LLM_BASE_URL: 'https://gw.example.com' } });
        expect(r.status).toBe(200);
        // registry validate 의 trim 변환이 적용된 값으로 저장
        expect(mockService.update).toHaveBeenCalledWith(
            { GOOGLE_CSE_ID: 'my-cse-id', LLM_BASE_URL: 'https://gw.example.com' },
            'test-admin',
        );
        expect(r.body.data.requiresRestart).toEqual(['LLM_BASE_URL']);
        // audit details 에 값이 실리지 않는다
        expect(logAudit).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'system_settings.updated',
                details: { keys: ['GOOGLE_CSE_ID', 'LLM_BASE_URL'], requiresRestart: ['LLM_BASE_URL'] },
            }),
        );
        const auditArg = JSON.stringify(logAudit.mock.calls[0][0]);
        expect(auditArg).not.toContain('my-cse-id');
    });

    test('PUT — 허용되지 않은 키 400', async () => {
        const r = await request(app)
            .put('/api/admin/system-settings')
            .send({ entries: { EVIL_KEY: 'x' } });
        expect(r.status).toBe(400);
        expect(mockService.update).not.toHaveBeenCalled();
    });

    test('PUT — 형식 위반 400 (webhook 은 https 필수)', async () => {
        const r = await request(app)
            .put('/api/admin/system-settings')
            .send({ entries: { OPERATOR_WEBHOOK_URL: 'http://insecure.example.com' } });
        expect(r.status).toBe(400);
        expect(mockService.update).not.toHaveBeenCalled();
    });

    test('PUT — 빈 entries 400', async () => {
        const r = await request(app).put('/api/admin/system-settings').send({ entries: {} });
        expect(r.status).toBe(400);
    });

    test('DELETE — env 폴백 복귀 + audit', async () => {
        const r = await request(app).delete('/api/admin/system-settings/GOOGLE_CSE_ID');
        expect(r.status).toBe(200);
        expect(mockService.reset).toHaveBeenCalledWith('GOOGLE_CSE_ID');
        expect(logAudit).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'system_settings.reset', details: { key: 'GOOGLE_CSE_ID' } }),
        );
    });

    test('DELETE — 허용되지 않은 키 400 / DB 미설정 키 404', async () => {
        const bad = await request(app).delete('/api/admin/system-settings/EVIL_KEY');
        expect(bad.status).toBe(400);

        mockService.reset.mockResolvedValueOnce(false);
        const missing = await request(app).delete('/api/admin/system-settings/GOOGLE_CSE_ID');
        expect(missing.status).toBe(404);
    });
});
