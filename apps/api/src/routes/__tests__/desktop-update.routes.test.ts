/**
 * 데스크톱 업데이트 매니페스트 — macOS 는 네이티브 컴패니언만 (2026-09-11).
 * 최상위(기본) 값은 native 블록을 따르고, 구 Electron 필드·dmg 는 응답·다운로드에서 빠진다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import request from 'supertest';

// 게시 폴더를 점 폴더 아래에 둔다 — 설치본은 `~/.openmake/data/desktop-updates` 이고,
// root 없이 절대경로를 send 에 넘기면 조상의 점 폴더 때문에 404 가 된다(스테이징 재현).
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-desktop-update-'));
const DIR = path.join(BASE, '.openmake', 'data', 'desktop-updates');
fs.mkdirSync(DIR, { recursive: true });
const NATIVE = { version: '0.2.6', file: 'OpenMake-Companion-0.2.6-arm64.dmg', sha256: 'a'.repeat(64) };
const ELECTRON = { version: '1.10.0', file: 'OpenMake-1.10.0-arm64.dmg', sha256: 'b'.repeat(64) };

function writeManifest(m: unknown): void {
    fs.writeFileSync(path.join(DIR, 'latest.json'), JSON.stringify(m));
}

let app: express.Express;

beforeAll(async () => {
    process.env.DESKTOP_UPDATE_DIR = DIR; // DESKTOP_UPDATE.DIR 는 모듈 로드 시점에 읽힌다
    const { default: router } = await import('../desktop-update.routes');
    app = express();
    // 전역 setupSecurity(middlewares/setup.ts) 가 /api 응답에 JSON content-type 을 미리 박는 것을 흉내 낸다.
    app.use((_req, res, next) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); next(); });
    app.use('/api/desktop', router);
    fs.writeFileSync(path.join(DIR, NATIVE.file), 'companion');
    fs.writeFileSync(path.join(DIR, ELECTRON.file), 'electron');
});

afterAll(() => {
    fs.rmSync(BASE, { recursive: true, force: true });
    delete process.env.DESKTOP_UPDATE_DIR;
});

beforeEach(() => fs.rmSync(path.join(DIR, 'latest.json'), { force: true }));

describe('GET /api/desktop/latest', () => {
    it('최상위(기본) 값은 컴패니언이고 native 블록도 같은 값으로 싣는다', async () => {
        writeManifest({ native: NATIVE });
        const res = await request(app).get('/api/desktop/latest');
        expect(res.status).toBe(200);
        const url = `/api/desktop/download/${NATIVE.file}`;
        expect(res.body.data).toEqual({ ...NATIVE, url, native: { ...NATIVE, url } });
    });

    it('구 Electron 최상위 필드가 남아 있어도 무시하고 컴패니언을 기본으로 낸다', async () => {
        writeManifest({ ...ELECTRON, native: NATIVE });
        const res = await request(app).get('/api/desktop/latest');
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ version: NATIVE.version, file: NATIVE.file, sha256: NATIVE.sha256 });
    });

    it('native 블록이 없으면(Electron 만) 404', async () => {
        writeManifest(ELECTRON);
        expect((await request(app).get('/api/desktop/latest')).status).toBe(404);
    });

    it('native 파일명이 컴패니언 형식이 아니면 404', async () => {
        writeManifest({ native: { ...NATIVE, file: ELECTRON.file } });
        expect((await request(app).get('/api/desktop/latest')).status).toBe(404);
    });

    it('매니페스트가 없으면 404', async () => {
        expect((await request(app).get('/api/desktop/latest')).status).toBe(404);
    });
});

describe('GET /api/desktop/download/:file', () => {
    it('컴패니언 dmg 는 내려준다 — 점 폴더 아래여도 200, JSON 이 아닌 디스크 이미지 MIME', async () => {
        const res = await request(app).get(`/api/desktop/download/${NATIVE.file}`).buffer(true).parse((r, cb) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
        expect(res.status).toBe(200);
        expect((res.body as Buffer).toString()).toBe('companion');
        expect(res.headers['content-type']).toBe('application/x-apple-diskimage');
        expect(res.headers['content-disposition']).toMatch(/^attachment;/);
        expect(res.headers['content-disposition']).toContain(NATIVE.file);
    });

    it('없는 컴패니언 dmg 는 404 파일 없음', async () => {
        const res = await request(app).get('/api/desktop/download/OpenMake-Companion-9.9.9-arm64.dmg');
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).toContain('파일 없음');
    });

    it('구 Electron dmg 는 파일이 남아 있어도 거부한다', async () => {
        expect((await request(app).get(`/api/desktop/download/${ELECTRON.file}`)).status).toBe(400);
    });

    it('매니페스트 등 dmg 가 아닌 파일은 거부한다', async () => {
        expect((await request(app).get('/api/desktop/download/latest.json')).status).toBe(400);
    });
});

describe('Windows 설치 파일 (Companion P4)', () => {
    const WIN = { version: '0.1.0', file: 'OpenMake-Companion-Setup-0.1.0.exe', sha256: 'c'.repeat(64) };
    beforeAll(() => fs.writeFileSync(path.join(DIR, WIN.file), 'windows-installer'));

    it('windows 블록을 함께 싣고, 최상위 값은 종전대로 macOS 컴패니언이다', async () => {
        writeManifest({ native: NATIVE, windows: WIN });
        const res = await request(app).get('/api/desktop/latest');
        expect(res.body.data.version).toBe(NATIVE.version);
        expect(res.body.data.windows).toEqual({ ...WIN, url: `/api/desktop/download/${WIN.file}` });
    });

    it('windows 블록만 있어도 응답한다 — 최상위(macOS) 값은 없다', async () => {
        writeManifest({ windows: WIN });
        const res = await request(app).get('/api/desktop/latest');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ windows: { ...WIN, url: `/api/desktop/download/${WIN.file}` } });
    });

    it('파일명이 패턴에 맞지 않는 windows 블록은 싣지 않는다', async () => {
        writeManifest({ native: NATIVE, windows: { ...WIN, file: '..\\evil.exe' } });
        const res = await request(app).get('/api/desktop/latest');
        expect(res.body.data.windows).toBeUndefined();
    });

    it('설치 파일은 내려받을 수 있고, 다른 exe 는 거부한다', async () => {
        const ok = await request(app).get(`/api/desktop/download/${WIN.file}`).buffer(true).parse((r, cb) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
        expect(ok.status).toBe(200);
        expect((ok.body as Buffer).toString()).toBe('windows-installer');
        expect(ok.headers['content-type']).not.toMatch(/json/);
        expect(ok.headers['content-disposition']).toMatch(/^attachment;/);
        expect(ok.headers['content-disposition']).toContain(WIN.file);
        expect((await request(app).get('/api/desktop/download/evil.exe')).status).toBe(400);
        expect((await request(app).get('/api/desktop/download/OpenMake-Companion-Setup-1.0.0.exe')).status).toBe(404);
    });
});

describe('GET /api/desktop/config', () => {
    it('API 포트와 웹 포트를 알려 준다 — 인증 없이', async () => {
        const res = await request(app).get('/api/desktop/config');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ apiPort: expect.any(Number), webPort: expect.any(Number) });
    });
});

describe('resolveDesktopPorts — 웹 포트 규칙은 resolve-ports.cjs 와 같다', () => {
    it('OMK_WEB_PORT → OMK_APP_URL 끝의 포트 → 3000', async () => {
        const { resolveDesktopPorts } = await import('../../config/desktop-update');
        expect(resolveDesktopPorts(52418, { OMK_WEB_PORT: '3010', OMK_APP_URL: 'https://chat.example.com:8443' })).toEqual({ apiPort: 52418, webPort: 3010 });
        expect(resolveDesktopPorts(52416, { OMK_APP_URL: 'http://host:33000/' })).toEqual({ apiPort: 52416, webPort: 33000 });
        expect(resolveDesktopPorts(52416, { OMK_APP_URL: 'https://chat.example.com' })).toEqual({ apiPort: 52416, webPort: 3000 });
        expect(resolveDesktopPorts(52416, {})).toEqual({ apiPort: 52416, webPort: 3000 });
    });
});
