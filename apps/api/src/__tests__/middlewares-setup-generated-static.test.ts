/**
 * setupStaticFiles — 백엔드 정적 서빙은 `/generated` 마운트 아래로 한정한다(2026-11-07 점검).
 * 마운트 밖 경로로는 생성 산출물이 내려가지 않고, `/generated/<name>` 은 소유권 라우터를 지난다.
 * 예약 리포트(`/generated/reports/*`)는 종전대로 static 이 공개 서빙한다.
 */
jest.mock('../middlewares/index', () => {
    const pass = (_req: unknown, _res: unknown, next: () => void) => next();
    return new Proxy({}, { get: (_t, name) => (name === '__esModule' ? false : pass) });
});
jest.mock('../config', () => ({ getConfig: () => ({ trustedProxies: [] }) }));
jest.mock('../auth', () => ({
    optionalAuth: async (_req: unknown, _res: unknown, next: () => void) => { next(); },
    requireAuth: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => { res.status(401).json({}); },
}));
const mockResolveArtifactForRead = jest.fn();
jest.mock('../runtime-ports/artifact-store', () => ({
    resolveArtifactForRead: (...args: unknown[]) => mockResolveArtifactForRead(...args),
    issueDeliveryTicket: () => '123.sig',
}));

import express from 'express';
import request from 'supertest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setupStaticFiles } from '../middlewares/setup';

describe('setupStaticFiles — /generated 정적 서빙 범위', () => {
    let root: string;
    let generatedDir: string;
    let app: express.Express;
    const ORIGINAL_REDIRECT = process.env.FRONTEND_REDIRECT_URL;

    beforeAll(() => {
        delete process.env.FRONTEND_REDIRECT_URL;
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-static-'));
        const publicDir = path.join(root, 'apps', 'legacy-web', 'public');
        generatedDir = path.join(publicDir, 'generated');
        fs.mkdirSync(path.join(generatedDir, 'reports'), { recursive: true });
        fs.writeFileSync(path.join(generatedDir, 'a.png'), 'PNGDATA');
        fs.writeFileSync(path.join(generatedDir, 'reports', 'r.html'), '<h1>r</h1>');
        fs.writeFileSync(path.join(publicDir, 'other.txt'), 'OTHER');
        app = express();
        // setupStaticFiles 는 `<dirname>/../../../apps/legacy-web/public` 을 쓴다
        setupStaticFiles(app, path.join(root, 'a', 'b', 'c'));
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
        if (ORIGINAL_REDIRECT === undefined) delete process.env.FRONTEND_REDIRECT_URL;
        else process.env.FRONTEND_REDIRECT_URL = ORIGINAL_REDIRECT;
    });

    beforeEach(() => {
        mockResolveArtifactForRead.mockReset();
        mockResolveArtifactForRead.mockResolvedValue({ ok: false, status: 404, reason: 'not_found' });
    });

    it('/generated/reports/* 는 static 이 그대로 서빙한다', async () => {
        const res = await request(app).get('/generated/reports/r.html');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<h1>r</h1>');
        expect(mockResolveArtifactForRead).not.toHaveBeenCalled();
    });

    it('/generated/<name> 은 소유권 라우터를 지난다', async () => {
        mockResolveArtifactForRead.mockResolvedValue({ ok: true, absPath: path.join(generatedDir, 'a.png'), mime: 'image/png', row: null, reason: 'owner' });
        const res = await request(app).get('/generated/a.png');
        expect(res.status).toBe(200);
        expect(mockResolveArtifactForRead).toHaveBeenCalledWith('a.png', expect.anything());
    });

    it('소유권 판정이 거부하면 static 으로 새지 않는다', async () => {
        const res = await request(app).get('/generated/a.png');
        expect(res.status).toBe(404);
        expect(res.text ?? '').not.toContain('PNGDATA');
    });

    it.each(['//generated/a.png', '/%67enerated/a.png'])('마운트 밖 경로 %s 로는 산출물이 내려가지 않는다', async (url) => {
        const res = await request(app).get(url);
        expect(res.status).not.toBe(200);
        expect(res.text ?? '').not.toContain('PNGDATA');
    });

    it('legacy public 루트의 다른 파일은 서빙하지 않는다', async () => {
        const res = await request(app).get('/other.txt');
        expect(res.status).toBe(404);
    });
});
