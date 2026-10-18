/**
 * GDPR export 의 add-on 소유 데이터 — 각 add-on 의 데이터 모듈(꺼진 add-on 도 호스트가 불러온다)이 싣는다.
 * 모듈을 불러오지 못했거나 조회가 실패하면 `addon:<id>` 를 실패 카테고리로 드러내고 나머지는 계속한다.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../auth/middleware', () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        (req as unknown as { user: unknown }).user = { userId: 'u1', role: 'user' }; next();
    },
}));
jest.mock('../../data/user-manager', () => ({ isAdminRole: () => false }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({ query: async () => ({ rows: [] }) }) }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }) }));
const dataModules = jest.fn();
jest.mock('../../addon-host/addon-data', () => ({ getAddonDataModules: () => dataModules() }));

import { createExportController } from '../export.controller';

const app = express();
app.use('/api/users/me/export', createExportController());

describe('export controller — add-on 소유 데이터', () => {
    it('add-on 들이 준 키를 최상위에 싣고 개수를 counts 에 싣는다', async () => {
        dataModules.mockReturnValue([
            { addonId: 'a', data: { exportUserData: async (uid: string) => ({ alphaRows: [{ uid }], betaRows: [] }) }, error: null },
            { addonId: 'b', data: { exportUserData: async () => ({ gammaRows: [1, 2, 3] }) }, error: null },
            { addonId: 'c', data: {}, error: null }, // 내보낼 데이터가 없는 add-on
        ]);
        const body = JSON.parse((await request(app).get('/api/users/me/export').expect(200)).text);
        expect(body.alphaRows).toEqual([{ uid: 'u1' }]);
        expect(body.gammaRows).toEqual([1, 2, 3]);
        expect(body._meta.counts).toMatchObject({ alphaRows: 1, betaRows: 0, gammaRows: 3 });
        expect(body._meta.failedCategories).toEqual([]);
    });

    it('모듈을 불러오지 못했거나 조회가 실패한 add-on 은 addon:<id> 로 드러내고 나머지는 계속한다', async () => {
        dataModules.mockReturnValue([
            { addonId: 'broken', data: null, error: 'Cannot find module' },
            { addonId: 'flaky', data: { exportUserData: async () => { throw new Error('db down'); } }, error: null },
            { addonId: 'fine', data: { exportUserData: async () => ({ fineRows: ['x'] }) }, error: null },
        ]);
        const body = JSON.parse((await request(app).get('/api/users/me/export').expect(200)).text);
        expect(body._meta.failedCategories).toEqual(['addon:broken', 'addon:flaky']);
        expect(body._meta.partial).toBe(true);
        expect(body.fineRows).toEqual(['x']);
    });
});
