/**
 * 작업 생성 multipart 총량 상한 (E4) — multer 의 fileSize 는 파일당 상한이라 여러 파일 합이
 * REQUEST_BODY_MAX_BYTES 를 넘어도 통과했다. createBodyMw 가 합계를 검사해 413 으로 거절하고,
 * 이미 디스크에 쓴 임시 파일을 지우는지 실제 multer 스트리밍으로 확인한다.
 */
import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-task-total-'));
process.env.AGENT_TASK_UPLOAD_ROOT = TMP_ROOT;
process.env.AGENT_TASK_BODY_MAX_BYTES = '100';

// env 반영을 위해 상수 모듈보다 늦게 로드 (import 는 호이스팅되므로 require)
const { createBodyMw } = require('../agent-task-create-inputs') as typeof import('../agent-task-create-inputs');

const app = express();
app.post('/', createBodyMw, (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    res.json({ count: files.length, total: files.reduce((s, f) => s + f.size, 0) });
});

const tmpFiles = () => {
    try { return fs.readdirSync(path.join(TMP_ROOT, 'tmp')); } catch { return []; }
};

afterAll(() => { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); });

describe('createBodyMw multipart 합계 상한', () => {
    it('파일 합계가 상한 이하면 그대로 통과한다', async () => {
        const res = await request(app).post('/')
            .attach('files', Buffer.alloc(40, 1), 'a.bin')
            .attach('files', Buffer.alloc(40, 2), 'b.bin');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ count: 2, total: 80 });
        for (const f of tmpFiles()) fs.rmSync(path.join(TMP_ROOT, 'tmp', f), { force: true });
    });

    it('파일마다는 상한 이하여도 합계가 넘으면 413 이고 임시 파일을 지운다', async () => {
        const res = await request(app).post('/')
            .attach('files', Buffer.alloc(60, 1), 'a.bin')
            .attach('files', Buffer.alloc(60, 2), 'b.bin');
        expect(res.status).toBe(413);
        expect(res.body.success).toBe(false);
        expect(JSON.stringify(res.body)).toContain('100');
        expect(tmpFiles()).toEqual([]);
    });
});
