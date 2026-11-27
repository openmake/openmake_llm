/**
 * 관리자 확장 현황 라우트(M3) — 관리자 전용·플래그 OFF 404·필터/커서 전달 고정.
 */
const listExtensionInventory = jest.fn();
const previewExtensionSourcePolicy = jest.fn();

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
jest.mock('../../services/extensions/inventory', () => ({
    listExtensionInventory: (...a: unknown[]) => listExtensionInventory(...a),
    previewExtensionSourcePolicy: (...a: unknown[]) => previewExtensionSourcePolicy(...a),
}));

import express from 'express';
import request from 'supertest';
import { adminExtensionsRouter } from '../admin-extensions.routes';
import { errorHandler } from '../../utils/error-handler';
import { encodeInventoryCursor } from '../../data/repositories/extension-inventory-repository';
import { resetConfig } from '../../config/env';

const app = express();
app.use(express.json());
app.use('/api/admin', adminExtensionsRouter);
app.use(errorHandler);

const KEY = 'EXTENSION_ADMIN_INVENTORY_ENABLED';
const ORIGINAL = process.env[KEY];
/** 플래그는 getConfig 캐시를 거친다 — env 를 바꾼 뒤 캐시를 비운다 */
function setFlag(v: string | undefined): void {
    if (v === undefined) delete process.env[KEY]; else process.env[KEY] = v;
    resetConfig();
}
afterEach(() => {
    setFlag(ORIGINAL);
    jest.clearAllMocks();
});

describe('GET /api/admin/extensions/*', () => {
    it('관리자가 아니면 403 — 타인 설치 정보를 보지 못한다', async () => {
        setFlag('true');
        for (const p of ['status', 'inventory', 'policy-preview']) {
            const res = await request(app).get(`/api/admin/extensions/${p}`).set('x-test-role', 'user');
            expect(res.status).toBe(403);
        }
        expect(listExtensionInventory).not.toHaveBeenCalled();
        expect(previewExtensionSourcePolicy).not.toHaveBeenCalled();
    });

    it('플래그 OFF(기본) — status 는 enabled:false, 현황·미리보기는 404', async () => {
        setFlag(undefined);
        const st = await request(app).get('/api/admin/extensions/status').set('x-test-role', 'admin');
        expect(st.status).toBe(200);
        expect(st.body.data).toEqual({ enabled: false });
        expect((await request(app).get('/api/admin/extensions/inventory').set('x-test-role', 'admin')).status).toBe(404);
        expect((await request(app).get('/api/admin/extensions/policy-preview').set('x-test-role', 'admin')).status).toBe(404);
        expect(listExtensionInventory).not.toHaveBeenCalled();
        expect(previewExtensionSourcePolicy).not.toHaveBeenCalled();
    });

    it('플래그 ON — 필터·커서·limit 을 서비스에 넘긴다', async () => {
        setFlag('true');
        listExtensionInventory.mockResolvedValue({ items: [], nextCursor: null, sources: [] });
        const cursor = encodeInventoryCursor({ createdAt: '2026-11-27T00:00:00.000Z', id: 'user-ext-1' });
        const res = await request(app)
            .get('/api/admin/extensions/inventory')
            .query({ q: 'pack', userId: 'u7', source: 'github.com/a', status: 'active', limit: '20', cursor })
            .set('x-test-role', 'admin');
        expect(res.status).toBe(200);
        expect(listExtensionInventory).toHaveBeenCalledWith(
            expect.anything(),
            { q: 'pack', userId: 'u7', source: 'github.com/a', status: 'active' },
            { limit: 20, cursor: { createdAt: '2026-11-27T00:00:00.000Z', id: 'user-ext-1' } },
        );
    });

    it('깨진 커서 400, 범위 밖 limit 400', async () => {
        setFlag('true');
        expect((await request(app).get('/api/admin/extensions/inventory?cursor=%%%').set('x-test-role', 'admin')).status).toBe(400);
        expect((await request(app).get('/api/admin/extensions/inventory?limit=1000').set('x-test-role', 'admin')).status).toBe(400);
        expect(listExtensionInventory).not.toHaveBeenCalled();
    });

    it('플래그 ON — 미리보기 결과를 그대로 돌려준다', async () => {
        setFlag('true');
        previewExtensionSourcePolicy.mockResolvedValue({ enforced: false, arbitraryUrlInstall: 'allow', checked: 1, blocked: [], truncated: false });
        const res = await request(app).get('/api/admin/extensions/policy-preview').set('x-test-role', 'admin');
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ checked: 1, blocked: [] });
    });
});
