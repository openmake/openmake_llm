/**
 * `GET /api/extension-marketplace/verdicts` — add-on 게이트(꺼짐 404 · 조직 밖 403)를 실제로 지나고,
 * 게스트 401 · catalogId 없음 400 · 정상 200.
 */
import express from 'express';
import request from 'supertest';

const checkAddonEntitlement = jest.fn();
jest.mock('../../../services/addon/entitlement', () => ({ checkAddonEntitlement: (...a: unknown[]) => checkAddonEntitlement(...a) }));

let signedIn = true;
jest.mock('../../../auth', () => ({
    optionalAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => { if (signedIn) req.user = { id: 3, userId: 3 }; next(); },
}));

const getCatalogVerdicts = jest.fn();
jest.mock('../service', () => ({ getCatalogVerdicts: (...a: unknown[]) => getCatalogVerdicts(...a) }));

import { addonGuard } from '../../../addon-host/routes';
import { errorHandler } from '../../../utils/error-handler';
import { extensionMarketplaceRouter } from '../routes';

function app() {
    const a = express();
    a.use('/api/extension-marketplace', addonGuard('extension-marketplace'), extensionMarketplaceRouter);
    a.use(errorHandler);
    return a;
}

beforeEach(() => {
    jest.clearAllMocks();
    signedIn = true;
    checkAddonEntitlement.mockResolvedValue('ok');
    getCatalogVerdicts.mockResolvedValue({ catalogId: 'ext-cat-1', verdictVersion: 1, verdicts: [] });
});

describe('extension-marketplace routes', () => {
    it('add-on 이 꺼져 있으면 404 — 판정 서비스에 닿지 않는다', async () => {
        checkAddonEntitlement.mockResolvedValue('disabled');
        const r = await request(app()).get('/api/extension-marketplace/verdicts?catalogId=ext-cat-1');
        expect(r.status).toBe(404);
        expect(r.body.error.code).toBe('ADDON_DISABLED');
        expect(getCatalogVerdicts).not.toHaveBeenCalled();
    });

    it('조직 허용 목록 밖이면 403', async () => {
        checkAddonEntitlement.mockResolvedValue('not-entitled');
        const r = await request(app()).get('/api/extension-marketplace/verdicts?catalogId=ext-cat-1');
        expect(r.status).toBe(403);
        expect(checkAddonEntitlement).toHaveBeenCalledWith('extension-marketplace', '3');
        expect(getCatalogVerdicts).not.toHaveBeenCalled();
    });

    it('게스트는 401', async () => {
        signedIn = false;
        const r = await request(app()).get('/api/extension-marketplace/verdicts?catalogId=ext-cat-1');
        expect(r.status).toBe(401);
        expect(getCatalogVerdicts).not.toHaveBeenCalled();
    });

    it('catalogId 가 없으면 400', async () => {
        const r = await request(app()).get('/api/extension-marketplace/verdicts');
        expect(r.status).toBe(400);
    });

    it('정상 — 판정 목록', async () => {
        const r = await request(app()).get('/api/extension-marketplace/verdicts?catalogId=ext-cat-1');
        expect(r.status).toBe(200);
        expect(r.body.success).toBe(true);
        expect(r.body.data).toEqual({ catalogId: 'ext-cat-1', verdictVersion: 1, verdicts: [] });
        expect(getCatalogVerdicts).toHaveBeenCalledWith('ext-cat-1');
    });
});
