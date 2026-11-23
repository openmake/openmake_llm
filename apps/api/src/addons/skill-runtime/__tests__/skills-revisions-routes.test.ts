/**
 * skills.routes — 이전 버전 목록·복원. 소유자·관리자만, 시스템 스킬 목록은 관리자만.
 * 복원은 이력 내용으로 다시 수정(updateSkill)한다 — 지금 내용은 그 수정이 이력에 남긴다.
 */
import express from 'express';
import request from 'supertest';

type TestReq = { headers: Record<string, string | undefined>; user?: unknown };
type TestRes = { status: (n: number) => { json: (b: unknown) => void } };

jest.mock('../../../auth', () => ({
    optionalAuth: (_req: TestReq, _res: TestRes, next: () => void) => next(),
    requireAuth: (req: TestReq, res: TestRes, next: () => void) => {
        if (!req.headers['x-test-user']) { res.status(401).json({}); return; }
        req.user = { userId: req.headers['x-test-user'], role: req.headers['x-test-role'] ?? 'user' };
        next();
    },
    requireAdmin: (_req: TestReq, res: TestRes) => { res.status(403).json({}); },
}));
const skills: Record<string, { id: string; createdBy?: string }> = {
    mine: { id: 'mine', createdBy: '42' },
    sys: { id: 'sys' },
};
const updateSkill = jest.fn();
jest.mock('../skill-manager', () => ({
    getSkillManager: () => ({
        getSkillById: async (id: string) => skills[id] ?? null,
        updateSkill: (...a: unknown[]) => updateSkill(...a),
    }),
}));
const listMock = jest.fn();
const getMock = jest.fn();
jest.mock('../data/skill-revision-repository', () => ({
    SkillRevisionRepository: jest.fn().mockImplementation(() => ({ list: (...a: unknown[]) => listMock(...a), get: (...a: unknown[]) => getMock(...a) })),
}));
jest.mock('../../../runtime-ports/db-access', () => ({ getPool: () => ({}) }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

import skillsRouter from '../routes/skills.routes';
import { errorHandler } from '../../../utils/error-handler';

const app = express();
app.use(express.json());
app.use('/api/agents/skills', skillsRouter);
app.use(errorHandler);

const as = (user: string, role = 'user') => ({ 'x-test-user': user, 'x-test-role': role });
const rev = { id: '5', skillId: 'mine', name: 'Old', description: 'old desc', content: '# old', category: 'coding', replacedBy: '42', createdAt: '2026-11-20T00:00:00.000Z' };

beforeEach(() => {
    updateSkill.mockReset(); listMock.mockReset(); getMock.mockReset();
    listMock.mockResolvedValue([rev]);
    updateSkill.mockResolvedValue({ id: 'mine', name: 'Old' });
});

describe('GET /:skillId/revisions', () => {
    it('소유자는 목록을 받는다', async () => {
        const res = await request(app).get('/api/agents/skills/mine/revisions').set(as('42'));
        expect(res.status).toBe(200);
        expect(res.body.data.revisions).toEqual([rev]);
        expect(listMock).toHaveBeenCalledWith('mine');
    });

    it('남의 스킬은 403, 없는 스킬은 404', async () => {
        expect((await request(app).get('/api/agents/skills/mine/revisions').set(as('7'))).status).toBe(403);
        expect((await request(app).get('/api/agents/skills/nope/revisions').set(as('42'))).status).toBe(404);
        expect(listMock).not.toHaveBeenCalled();
    });

    it('시스템 스킬 이력은 관리자만', async () => {
        expect((await request(app).get('/api/agents/skills/sys/revisions').set(as('42'))).status).toBe(403);
        expect((await request(app).get('/api/agents/skills/sys/revisions').set(as('1', 'admin'))).status).toBe(200);
    });
});

describe('POST /:skillId/revisions/:revisionId/restore', () => {
    it('이력 내용으로 다시 수정한다(공개 여부는 건드리지 않음)', async () => {
        getMock.mockResolvedValue(rev);
        const res = await request(app).post('/api/agents/skills/mine/revisions/5/restore').set(as('42'));
        expect(res.status).toBe(200);
        expect(getMock).toHaveBeenCalledWith('mine', '5');
        expect(updateSkill).toHaveBeenCalledWith('mine', { name: 'Old', description: 'old desc', content: '# old', category: 'coding' }, { userId: '42', userRole: 'user' });
    });

    it('없는 이력은 404, 남의 스킬은 403 — 둘 다 수정하지 않는다', async () => {
        getMock.mockResolvedValue(null);
        expect((await request(app).post('/api/agents/skills/mine/revisions/99/restore').set(as('42'))).status).toBe(404);
        expect((await request(app).post('/api/agents/skills/mine/revisions/5/restore').set(as('7'))).status).toBe(403);
        expect(updateSkill).not.toHaveBeenCalled();
    });
});
