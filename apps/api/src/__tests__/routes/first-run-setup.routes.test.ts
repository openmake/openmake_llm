/**
 * first-run-setup.routes — 첫 실행 셋업 마법사 API 테스트 (무DB, 전부 mock).
 */
import express from 'express';
import request from 'supertest';

let adminCount = 0;
const createUser = jest.fn(async (input: { email: string; role: string }) => ({
    id: '10', email: input.email, role: input.role,
}));
jest.mock('../../data/user-manager', () => ({
    getUserManager: () => ({
        createUser,
        hasAdminUser: jest.fn(async () => adminCount > 0),
    }),
}));

const settingsUpdate = jest.fn(async () => ({ requiresRestart: [] }));
// advisory lock 은 DB 세션이 필요하므로 단위 테스트에선 통과시키고 호출 사실만 기록
const withAdvisoryLock = jest.fn(async (_key: number, fn: () => Promise<unknown>) => fn());
jest.mock('../../data/advisory-lock', () => ({ withAdvisoryLock: (k: number, f: () => Promise<unknown>) => withAdvisoryLock(k, f) }));
jest.mock('../../services/system-settings-service', () => ({
    getSystemSettingsService: () => ({ update: settingsUpdate }),
}));

const logAudit = jest.fn(async () => undefined);
jest.mock('../../services/AuditService', () => ({
    getAuditService: () => ({ logAudit }),
}));

import { firstRunSetupRouter } from '../../routes/first-run-setup.routes';

const VALID_BODY = {
    adminEmail: 'owner@example.com',
    adminPassword: 'Str0ng!pass',
};

describe('first-run-setup.routes', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/setup', firstRunSetupRouter);
    });

    beforeEach(() => {
        adminCount = 0;
        jest.clearAllMocks();
    });

    test('status — admin 0명이면 setupNeeded=true + defaults 노출', async () => {
        const r = await request(app).get('/api/setup/status');
        expect(r.status).toBe(200);
        expect(r.body.data.setupNeeded).toBe(true);
        expect(r.body.data.defaults.llmBaseUrl).toBeTruthy();
    });

    test('status — admin 존재 시 setupNeeded=false, defaults 미노출', async () => {
        adminCount = 1;
        const r = await request(app).get('/api/setup/status');
        expect(r.body.data.setupNeeded).toBe(false);
        expect(r.body.data.defaults).toBeUndefined();
    });

    test('POST — 관리자 생성 + LLM 설정 저장 + audit', async () => {
        const r = await request(app).post('/api/setup').send({
            ...VALID_BODY,
            llmBaseUrl: 'http://127.0.0.1:13401',
            llmApiKey: 'sk-master-key',
        });
        expect(r.status).toBe(200);
        expect(r.body.data.completed).toBe(true);
        expect(createUser).toHaveBeenCalledWith({
            email: 'owner@example.com', password: 'Str0ng!pass', role: 'admin',
        });
        expect(settingsUpdate).toHaveBeenCalledWith(
            { LLM_BASE_URL: 'http://127.0.0.1:13401', LLM_API_KEY: 'sk-master-key' },
            '10',
        );
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'setup.completed' }));
    });

    test('POST — LLM 입력 생략 시 설정 저장 없이 관리자만 생성', async () => {
        const r = await request(app).post('/api/setup').send(VALID_BODY);
        expect(r.status).toBe(200);
        expect(settingsUpdate).not.toHaveBeenCalled();
    });

    test('POST — admin 존재 시 403 (일회성)', async () => {
        adminCount = 1;
        const r = await request(app).post('/api/setup').send(VALID_BODY);
        expect(r.status).toBe(403);
        expect(createUser).not.toHaveBeenCalled();
    });

    test('POST — 약한 비밀번호 400 (대문자/숫자/특수문자 정책)', async () => {
        for (const bad of ['short1!', 'nouppercase1!', 'NoNumber!!', 'NoSpecial11']) {
            const r = await request(app).post('/api/setup').send({ ...VALID_BODY, adminPassword: bad });
            expect(r.status).toBe(400);
        }
        expect(createUser).not.toHaveBeenCalled();
    });

    test('POST — 잘못된 llmBaseUrl 400 (registry 검증, 관리자 미생성)', async () => {
        const r = await request(app).post('/api/setup').send({ ...VALID_BODY, llmBaseUrl: 'not-a-url' });
        expect(r.status).toBe(400);
        expect(createUser).not.toHaveBeenCalled();
    });

    test('POST — 이메일 중복(createUser null) 400', async () => {
        createUser.mockResolvedValueOnce(null as never);
        const r = await request(app).post('/api/setup').send(VALID_BODY);
        expect(r.status).toBe(400);
    });
});
