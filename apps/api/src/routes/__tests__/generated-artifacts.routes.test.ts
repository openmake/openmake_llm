/**
 * `/generated/<name>` 인증 핸들러(P04) — 백엔드 직결과 Next rewrite 경유가 같은 판정을 지난다(T28), reports/ 는 static 으로 통과.
 */
jest.mock('../../auth', () => ({
    optionalAuth: async (req: { headers: Record<string, string>; user?: unknown }, _res: unknown, next: () => void) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'] ?? 'user' }; next(); },
    requireAuth: (req: { headers: Record<string, string>; user?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => { if (!req.headers['x-test-user']) { res.status(401).json({}); return; } req.user = { id: req.headers['x-test-user'], role: 'user' }; next(); },
}));
// 키 검증(DB)만 대체 — 추출·스코프 검사는 실제 구현. 키 이름으로 소유자·스코프를 정한다
const API_KEYS: Record<string, { userId: string; scopes: string[] }> = {
    omk_live_chatkey0000000000000000: { userId: 'A', scopes: ['*'] },
    omk_live_bridgekey00000000000000: { userId: 'A', scopes: ['bridge'] },
};
jest.mock('../../middlewares/api-key-auth', () => ({
    ...jest.requireActual('../../middlewares/api-key-auth'),
    optionalApiKey: async (req: { headers: Record<string, string>; user?: unknown; authMethod?: string; apiKeyRecord?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
        const key = API_KEYS[(req.headers.authorization ?? '').replace('Bearer ', '')];
        if (!key) { res.status(401).json({}); return; }
        req.authMethod = 'api-key';
        req.apiKeyRecord = { scopes: key.scopes };
        req.user = { id: key.userId, role: 'user' };
        next();
    },
}));
const verdicts = new Map<string, unknown>();
const viewers: Array<{ userId?: string }> = [];
jest.mock('../../runtime-ports/artifact-store', () => ({
    resolveArtifactForRead: async (name: string, viewer: { userId?: string }) => { viewers.push(viewer); return verdicts.get(name) ?? { ok: false, status: 404, reason: 'not_found' }; },
    issueDeliveryTicket: () => '123.sig',
}));

import express from 'express';
import request from 'supertest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { generatedArtifactsRouter, generatedTicketRouter } from '../generated-artifacts.routes';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-gen-'));
fs.writeFileSync(path.join(tmp, 'ok.png'), 'PNGDATA');
fs.mkdirSync(path.join(tmp, 'reports'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'reports', 'r.html'), '<h1>r</h1>');

function app() {
    const a = express();
    a.use('/generated', generatedArtifactsRouter);
    a.use('/generated', express.static(tmp));
    a.use('/api/generated', generatedTicketRouter);
    return a;
}

beforeEach(() => { verdicts.clear(); viewers.length = 0;verdicts.set('ok.png', { ok: true, absPath: path.join(tmp, 'ok.png'), mime: 'image/png', row: null, reason: 'owner' }); });

describe('generatedArtifactsRouter', () => {
    it('숨김 설치 디렉터리 안에서도 소유권 판정을 통과한 파일만 전달한다', async () => {
        const hidden = path.join(tmp, '.openmake', 'generated-private');
        fs.mkdirSync(hidden, { recursive: true });
        const file = path.join(hidden, 'private.png');
        fs.writeFileSync(file, 'PRIVATEPNG');
        verdicts.set('private.png', { ok: true, absPath: file, mime: 'image/png', reason: 'owner' });
        const r = await request(app()).get('/generated/private.png').set('x-test-user', 'A');
        expect(r.status).toBe(200);
        expect(r.body.toString()).toBe('PRIVATEPNG');
        verdicts.set('private.png', { ok: false, status: 403, reason: 'forbidden' });
        expect((await request(app()).get('/generated/private.png').set('x-test-user', 'B')).status).toBe(403);
    });

    it('판정 통과 파일은 sendFile, 격리·거절은 상태코드 그대로(T28 — 같은 핸들러)', async () => {
        const r = await request(app()).get('/generated/ok.png').set('x-test-user', 'A');
        expect(r.status).toBe(200);
        expect(r.headers['content-type']).toMatch(/image\/png/);
        expect(r.headers['cache-control']).toMatch(/private/);
        verdicts.set('iso.png', { ok: false, status: 403, reason: 'isolated' });
        expect((await request(app()).get('/generated/iso.png')).status).toBe(403);
        expect((await request(app()).get('/generated/none.png')).status).toBe(404);
    });

    it('API 키(chat 스코프)로도 키 소유자로 판정한다 — JWT 가 없는 봇 클라이언트 경로', async () => {
        const r = await request(app()).get('/generated/ok.png').set('Authorization', 'Bearer omk_live_chatkey0000000000000000');
        expect(r.status).toBe(200);
        expect(viewers.at(-1)?.userId).toBe('A');
        // 무효 키는 401, chat 스코프 밖 키는 판정 전에 403
        expect((await request(app()).get('/generated/ok.png').set('Authorization', 'Bearer omk_live_unknownkey000000000000')).status).toBe(401);
        const before = viewers.length;
        expect((await request(app()).get('/generated/ok.png').set('Authorization', 'Bearer omk_live_bridgekey00000000000000')).status).toBe(403);
        expect(viewers.length).toBe(before);
    });

    it('reports/ 하위는 핸들러를 지나지 않고 static 으로 공개', async () => {
        const r = await request(app()).get('/generated/reports/r.html');
        expect(r.status).toBe(200);
        expect(r.text).toContain('<h1>r</h1>');
    });

    it('중첩 경로·이상한 파일명은 404, ?download=1 은 첨부 헤더', async () => {
        expect((await request(app()).get('/generated/a/ok.png')).status).toBe(404);
        const r = await request(app()).get('/generated/ok.png?download=1').set('x-test-user', 'A');
        expect(r.headers['content-disposition']).toMatch(/attachment/);
    });

    it('전달 티켓 발급은 인증 + 판정 통과가 필요하다', async () => {
        expect((await request(app()).get('/api/generated/ok.png/ticket')).status).toBe(401);
        const r = await request(app()).get('/api/generated/ok.png/ticket').set('x-test-user', 'A');
        expect(r.status).toBe(200);
        expect(r.body.data.url).toBe('/generated/ok.png?t=123.sig');
    });
});
