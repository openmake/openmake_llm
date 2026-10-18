/**
 * PATCH /api/admin/addons/:addonId/state — 상태 저장 뒤 같은 프로세스의 런타임에 반영(applyDesiredState)하고
 * 응답에 runtime 전이를 싣는다. restartRequired 는 restart_required 일 때만 true.
 */
const setState = jest.fn();
const applyDesiredState = jest.fn();
const logAudit = jest.fn(async (_e: unknown) => undefined);
const clearAddonStateCache = jest.fn();
const listRows = jest.fn();
const listBuiltinAddons = jest.fn((): unknown[] => []);

jest.mock('../../auth', () => {
    const { requireAdmin } = jest.requireActual('../../auth/middleware');
    return {
        requireAuth: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
            req.user = { id: '3', role: req.headers['x-test-role'] };
            next();
        },
        requireAdmin,
    };
});
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/repositories/addon-state-repository', () => ({
    ...jest.requireActual('../../data/repositories/addon-state-repository'),
    AddonStateRepository: jest.fn().mockImplementation(() => ({ setState: (...a: unknown[]) => setState(...a), list: () => listRows() })),
}));
jest.mock('../../addon-host/routes', () => ({ listBuiltinAddons: () => listBuiltinAddons() }));
jest.mock('../../addon-host/builtin-registry', () => ({ listBuiltinAddonDefs: () => [], isBuiltinAddonEnabled: () => true }));
jest.mock('../../addon-host/lifecycle', () => ({ applyDesiredState: (...a: unknown[]) => applyDesiredState(...a) }));
jest.mock('../../services/addon/model-requirements', () => ({ availableChatModelFacts: async () => [], checkModelRequirement: () => ({ ok: true, satisfiedBy: [] }) }));
jest.mock('../../services/addon/addon-state', () => ({ clearAddonStateCache: () => clearAddonStateCache() }));
jest.mock('../../services/addon/pack-verification', () => ({ loadPackVerifications: async () => new Map() }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: (e: unknown) => logAudit(e) }) }));

import express from 'express';
import request from 'supertest';
import { adminAddonsRouter } from '../admin-addons.routes';

const app = express();
app.use(express.json());
app.use('/api/admin', adminAddonsRouter);

const row = (desired: 'enabled' | 'disabled') => ({ addon_id: 'kn', state: desired, desired_state: desired });

beforeEach(() => { jest.clearAllMocks(); });

describe('PATCH /api/admin/addons/:addonId/state', () => {
    it('disabled → 의도대로 저장하고 런타임을 정지 — runtime stopped, restartRequired false', async () => {
        setState.mockResolvedValue(row('disabled'));
        applyDesiredState.mockResolvedValue('stopped');
        const res = await request(app).patch('/api/admin/addons/kn/state').set('x-test-role', 'admin').send({ state: 'disabled', reason: 't' });
        expect(res.status).toBe(200);
        expect(applyDesiredState).toHaveBeenCalledWith('kn', 'disabled');
        expect(clearAddonStateCache).toHaveBeenCalledTimes(1);
        expect(res.body.data).toMatchObject({ runtime: 'stopped', restartRequired: false });
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ details: { state: 'disabled', reason: 't', runtime: 'stopped' } }));
    });

    it('enabled 이고 런타임이 재개되면 runtime resumed, restartRequired false', async () => {
        setState.mockResolvedValue(row('enabled'));
        applyDesiredState.mockResolvedValue('resumed');
        const res = await request(app).patch('/api/admin/addons/kn/state').set('x-test-role', 'admin').send({ state: 'enabled' });
        expect(res.body.data).toMatchObject({ runtime: 'resumed', restartRequired: false });
    });

    it('enabled 인데 재개 수단이 없으면 runtime restart_required, restartRequired true', async () => {
        setState.mockResolvedValue(row('enabled'));
        applyDesiredState.mockResolvedValue('restart_required');
        const res = await request(app).patch('/api/admin/addons/kn/state').set('x-test-role', 'admin').send({ state: 'enabled' });
        expect(res.body.data).toMatchObject({ runtime: 'restart_required', restartRequired: true });
    });

    it('런타임 반영이 던져도 상태 저장은 성공으로 응답하고 restart_required 로 안내한다', async () => {
        setState.mockResolvedValue(row('disabled'));
        applyDesiredState.mockRejectedValue(new Error('boom'));
        const res = await request(app).patch('/api/admin/addons/kn/state').set('x-test-role', 'admin').send({ state: 'disabled' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ runtime: 'restart_required', restartRequired: true });
    });

    it('없는 add-on 은 404 이고 런타임을 건드리지 않는다', async () => {
        setState.mockResolvedValue(null);
        const res = await request(app).patch('/api/admin/addons/none/state').set('x-test-role', 'admin').send({ state: 'disabled' });
        expect(res.status).toBe(404);
        expect(applyDesiredState).not.toHaveBeenCalled();
    });

    it('관리자가 아니면 403 이고 저장·런타임 모두 건드리지 않는다', async () => {
        const res = await request(app).patch('/api/admin/addons/kn/state').set('x-test-role', 'user').send({ state: 'disabled' });
        expect(res.status).toBe(403);
        expect(setState).not.toHaveBeenCalled();
        expect(applyDesiredState).not.toHaveBeenCalled();
    });
});

describe('GET /api/admin/addons', () => {
    it('failureReason 은 state 가 failed 인 행에서만 내보낸다 — 다른 상태에 남은 값은 null', async () => {
        listBuiltinAddons.mockReturnValue([
            { id: 'ok', name: 'ok', version: '1.0.0', kind: 'runtime', enabled: true },
            { id: 'bad', name: 'bad', version: '1.0.0', kind: 'runtime', enabled: true },
        ]);
        listRows.mockResolvedValue([
            { addon_id: 'ok', state: 'enabled', desired_state: 'enabled', state_revision: 1, last_failure_code: null, failure_reason: 'stale', source: 'builtin', entitlement_sku: null, updated_at: null },
            { addon_id: 'bad', state: 'failed', desired_state: 'enabled', state_revision: 2, last_failure_code: 'runtime_failed', failure_reason: 'boom', source: 'builtin', entitlement_sku: null, updated_at: null },
        ]);
        const res = await request(app).get('/api/admin/addons').set('x-test-role', 'admin');
        expect(res.status).toBe(200);
        const byId = Object.fromEntries((res.body.data.addons as Array<{ id: string; failureReason: string | null }>).map(a => [a.id, a]));
        expect(byId.ok).toMatchObject({ state: 'enabled', failureReason: null });
        expect(byId.bad).toMatchObject({ state: 'failed', failureReason: 'boom' });
    });
});
