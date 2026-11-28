/**
 * 쿼터 관리자 API 의 F25 잔여 표면 — 플래그 OFF 면 종전 그대로(404·400), ON 이면 사용자별 한도 CRUD·조직/비용 grant.
 */
const flags = { overrides: false, orgGrants: false };
jest.mock('../../config/quota-extensions', () => ({
    quotaUserOverridesEnabled: () => flags.overrides,
    quotaOrgGrantsEnabled: () => flags.orgGrants,
    quotaOrgBucketEnabled: () => false,
    storageGeneratedDailySnapshotEnabled: () => false,
}));
jest.mock('../../auth/middleware', () => ({
    requireAuth: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
        req.user = { id: 'admin-1', role: req.headers['x-test-role'] ?? 'admin' };
        next();
    },
    requireAdmin: (req: { user?: { role?: string } }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
        if (req.user?.role !== 'admin') { res.status(403).json({ success: false }); return; }
        next();
    },
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const insertIfAbsent = jest.fn(async (_p: unknown) => true);
const insertGrantIfAbsent = jest.fn(async (_p: unknown) => true);
const listOrgGrants = jest.fn(async () => [{ id: 1 }]);
jest.mock('../../data/repositories/quota-grant-repository', () => ({
    QuotaGrantRepository: jest.fn().mockImplementation(() => ({ insertIfAbsent, insertGrantIfAbsent, listOrgGrants })),
}));
const upsert = jest.fn(async (userId: string, input: Record<string, unknown>) => ({ user_id: userId, ...input }));
const remove = jest.fn(async (_u: string) => true);
const list = jest.fn(async () => [] as unknown[]);
const userExists = jest.fn(async (_u: string) => true);
jest.mock('../../data/repositories/user-quota-override-repository', () => ({
    UserQuotaOverrideRepository: jest.fn().mockImplementation(() => ({ upsert, remove, list, userExists })),
}));
const logAudit = jest.fn(async (_e: unknown) => undefined);
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: (e: unknown) => logAudit(e) }) }));

import express from 'express';
import request from 'supertest';
import { adminQuotaOverageRouter } from '../../routes/quota-overage.routes';

const app = express();
app.use(express.json());
app.use('/api/admin', adminQuotaOverageRouter);

beforeEach(() => {
    flags.overrides = false; flags.orgGrants = false;
    [insertIfAbsent, insertGrantIfAbsent, listOrgGrants, upsert, remove, list, logAudit, userExists].forEach((m) => m.mockClear());
});

describe('사용자별 한도 덮어쓰기 API', () => {
    it('플래그 OFF: 목록·저장·삭제 모두 404, 저장소 호출 0', async () => {
        await request(app).get('/api/admin/quota-overrides').expect(404);
        await request(app).put('/api/admin/quota-overrides/u1').send({ hourlyTokenLimit: 1, weeklyTokenLimit: null, monthlyCostBudgetMicros: null }).expect(404);
        await request(app).delete('/api/admin/quota-overrides/u1').expect(404);
        expect(upsert).not.toHaveBeenCalled();
    });

    it('관리자가 아니면 403', async () => {
        flags.overrides = true;
        await request(app).get('/api/admin/quota-overrides').set('x-test-role', 'user').expect(403);
    });

    it('플래그 ON: 저장(NULL = 전역, 0 = 무제한)과 감사 기록', async () => {
        flags.overrides = true;
        const res = await request(app).put('/api/admin/quota-overrides/u1')
            .send({ hourlyTokenLimit: 5000, weeklyTokenLimit: null, monthlyCostBudgetMicros: 0, reason: 'pilot' }).expect(200);
        expect(res.body.data.override).toMatchObject({ user_id: 'u1', hourlyTokenLimit: 5000, weeklyTokenLimit: null, monthlyCostBudgetMicros: 0 });
        expect(upsert).toHaveBeenCalledWith('u1', { hourlyTokenLimit: 5000, weeklyTokenLimit: null, monthlyCostBudgetMicros: 0, reason: 'pilot' }, 'admin-1');
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'quota.override_changed', resourceId: 'u1' }));
    });

    it('플래그 ON: 음수·모르는 필드는 400, 없는 사용자는 404', async () => {
        flags.overrides = true;
        await request(app).put('/api/admin/quota-overrides/u1').send({ hourlyTokenLimit: -1, weeklyTokenLimit: null, monthlyCostBudgetMicros: null }).expect(400);
        await request(app).put('/api/admin/quota-overrides/u1').send({ hourlyTokenLimit: 1, weeklyTokenLimit: null, monthlyCostBudgetMicros: null, extra: 1 }).expect(400);
        userExists.mockResolvedValueOnce(false);
        await request(app).put('/api/admin/quota-overrides/nobody').send({ hourlyTokenLimit: 1, weeklyTokenLimit: null, monthlyCostBudgetMicros: null }).expect(404);
        expect(upsert).not.toHaveBeenCalled();
    });

    it('플래그 ON: 삭제 — 없으면 404', async () => {
        flags.overrides = true;
        await request(app).delete('/api/admin/quota-overrides/u1').expect(200);
        remove.mockResolvedValueOnce(false);
        await request(app).delete('/api/admin/quota-overrides/u2').expect(404);
    });
});

describe('수동 grant — 조직·비용 축', () => {
    it('종전 요청(userId + tokens)은 플래그와 무관하게 그대로', async () => {
        await request(app).post('/api/admin/quota-grants').send({ userId: 'u1', window: 'weekly', amount: 100 }).expect(201);
        expect(insertIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', window: 'weekly', amount: 100, kind: 'manual' }));
        expect(insertGrantIfAbsent).not.toHaveBeenCalled();
    });

    it('플래그 OFF: 조직·비용 grant 는 400, 목록은 404', async () => {
        await request(app).post('/api/admin/quota-grants').send({ subjectType: 'org', orgId: 'o1', window: 'monthly', amount: 100 }).expect(400);
        await request(app).post('/api/admin/quota-grants').send({ userId: 'u1', dimension: 'cost_micros', window: 'monthly', amount: 100 }).expect(400);
        await request(app).get('/api/admin/quota-grants?orgId=o1').expect(404);
        expect(insertGrantIfAbsent).not.toHaveBeenCalled();
    });

    it('플래그 ON: 조직 grant 는 월 버킷만, orgId 필수', async () => {
        flags.orgGrants = true;
        await request(app).post('/api/admin/quota-grants').send({ subjectType: 'org', orgId: 'o1', window: 'weekly', amount: 100 }).expect(400);
        await request(app).post('/api/admin/quota-grants').send({ subjectType: 'org', window: 'monthly', amount: 100 }).expect(400);
        await request(app).post('/api/admin/quota-grants').send({ subjectType: 'org', orgId: 'o1', window: 'monthly', amount: 100 }).expect(201);
        expect(insertGrantIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ subjectType: 'org', subjectId: 'o1', dimension: 'tokens', window: 'monthly' }));
        const res = await request(app).get('/api/admin/quota-grants?orgId=o1').expect(200);
        expect(res.body.data.grants).toHaveLength(1);
    });

    it('플래그 ON: 사용자 비용 grant', async () => {
        flags.orgGrants = true;
        await request(app).post('/api/admin/quota-grants').send({ userId: 'u1', dimension: 'cost_micros', window: 'monthly', amount: 2_000_000 }).expect(201);
        expect(insertGrantIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ subjectType: 'user', subjectId: 'u1', dimension: 'cost_micros', amount: 2_000_000 }));
    });
});

describe('GET /quota-features', () => {
    it('플래그 값을 그대로 보여 준다', async () => {
        flags.overrides = true;
        const res = await request(app).get('/api/admin/quota-features').expect(200);
        expect(res.body.data).toEqual({ userOverrides: true, orgGrants: false, orgBucket: false, storageDailySnapshot: false });
    });
});
