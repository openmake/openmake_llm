import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generatedDownloadHeader } from '../middlewares/setup';

describe('generatedDownloadHeader — /generated/*?download=1 첨부 응답', () => {
    let root: string;
    let app: express.Express;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-dl-'));
        fs.mkdirSync(path.join(root, 'generated'));
        fs.writeFileSync(path.join(root, 'generated', 'music-1.mp3'), 'ID3');
        app = express();
        app.use('/generated', generatedDownloadHeader);
        app.use(express.static(root));
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('download=1 이면 파일명과 함께 attachment 로 내려준다', async () => {
        const res = await request(app).get('/generated/music-1.mp3?download=1');
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toBe('attachment; filename="music-1.mp3"');
    });

    it('쿼리가 없으면 인라인 재생을 위해 Content-Disposition 을 붙이지 않는다', async () => {
        const res = await request(app).get('/generated/music-1.mp3');
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toBeUndefined();
    });

    it('없는 파일은 헤더와 무관하게 static 이 404 로 끝낸다', async () => {
        const res = await request(app).get('/generated/missing.mp3?download=1');
        expect(res.status).toBe(404);
    });
});
