/**
 * skills.routes — POST /upload 등록 회귀: 인증 → multer(file) → skills-upload 핸들러 순으로 연결된다.
 * 핸들러 본문은 skills-upload.test.ts 가 검사한다.
 */
import express from 'express';
import request from 'supertest';

type TestReq = { headers: Record<string, string | undefined>; user?: unknown };
type TestRes = { status: (n: number) => { json: (b: unknown) => void } };

jest.mock('../../../auth', () => ({
    optionalAuth: (_req: TestReq, _res: TestRes, next: () => void) => next(),
    requireAuth: (req: TestReq, res: TestRes, next: () => void) => {
        if (!req.headers['x-test-user']) { res.status(401).json({}); return; }
        req.user = { id: req.headers['x-test-user'], role: 'user' };
        next();
    },
    requireAdmin: (_req: TestReq, res: TestRes) => { res.status(403).json({}); },
}));

const uploadSkill = jest.fn(async (req: { file?: { originalname: string; buffer: Buffer } }, res: { json: (b: unknown) => void }) => {
    res.json({ received: req.file?.originalname, size: req.file?.buffer.length });
});
jest.mock('../routes/skills-upload', () => ({ uploadSkill: (...a: unknown[]) => (uploadSkill as jest.Mock)(...a) }));

import skillsRouter from '../routes/skills.routes';

const app = express();
app.use('/api/agents/skills', skillsRouter);

describe('POST /api/agents/skills/upload 등록', () => {
    beforeEach(() => uploadSkill.mockClear());

    it('인증이 없으면 핸들러에 닿지 않는다', async () => {
        const res = await request(app).post('/api/agents/skills/upload').attach('file', Buffer.from('x'), 'a.md');
        expect(res.status).toBe(401);
        expect(uploadSkill).not.toHaveBeenCalled();
    });

    it('인증되면 multer 가 file 을 붙여 skills-upload 핸들러로 넘긴다', async () => {
        const res = await request(app)
            .post('/api/agents/skills/upload')
            .set('x-test-user', '42')
            .attach('file', Buffer.from('---\nname: a\n---\n'), 'a.md');
        expect(res.status).toBe(200);
        expect(uploadSkill).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual({ received: 'a.md', size: 16 });
    });
});
