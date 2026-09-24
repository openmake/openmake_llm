/**
 * 통합 모델 배정 라우트 응답 계약 — 웹(apps/web)이 읽는 봉투 모양(packages/shared-types/src/model-assignments.ts)을 고정한다.
 * 서비스는 mock 하고 라우터만 태운다.
 */
import type { Request, Response, NextFunction } from 'express';

jest.mock('../../auth/middleware', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => { (req as unknown as { user: object }).user = { id: '3', userId: '3', role: 'admin' }; next(); },
}));
jest.mock('../../auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => { (req as unknown as { user: object }).user = { id: '3', userId: '3', role: 'admin' }; next(); },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));

const getResponse = {
    slots: [{ id: 'code', group: 'quality', kind: 'text', roles: ['review'], capabilities: ['text.code'], paramKeys: ['temperature'], available: true }],
    assignments: [{ slot: 'code', fullId: 'local-llm:qwen3.8-27b', params: { temperature: '0.2' }, updatedAt: '2026-09-24T00:00:00.000Z' }],
    effective: [{ slot: 'code', fullId: 'local-llm:qwen3.8-27b', source: 'user' }],
};
const mockPutAssignment = jest.fn(async (_opts: unknown) => ({ assignment: { slot: 'code', fullId: 'local-llm:qwen3.8-27b', params: {}, updatedAt: '2026-09-24T00:00:00.000Z' }, previous: null }));
const mockDeleteAssignment = jest.fn(async (_opts: unknown) => ({ previous: 'local-llm:qwen3.8-27b' }));
jest.mock('../../services/model-assignments-service', () => ({
    buildAssignmentsResponse: jest.fn(async () => getResponse),
    putAssignment: mockPutAssignment,
    deleteAssignment: mockDeleteAssignment,
}));

import express from 'express';
import request from 'supertest';
import { createModelAssignmentsController } from '../../controllers/model-assignments.controller';
import { adminModelAssignmentsRouter } from '../admin-model-assignments.routes';

const app = express();
app.use(express.json());
app.use('/api/users/me/model-assignments', createModelAssignmentsController());
app.use('/api/admin', adminModelAssignmentsRouter);

describe('model-assignments 라우트 응답 계약', () => {
    it('사용자 GET 은 { slots, assignments, effective }', async () => {
        const r = await request(app).get('/api/users/me/model-assignments');
        expect(r.status).toBe(200);
        expect(Object.keys(r.body.data).sort()).toEqual(['assignments', 'effective', 'slots']);
        expect(r.body.data.slots[0]).toHaveProperty('paramKeys');
        expect(r.body.data.effective[0]).toMatchObject({ slot: 'code', source: 'user' });
    });

    it('사용자 PUT 은 { assignment }', async () => {
        const r = await request(app).put('/api/users/me/model-assignments/code').send({ model: 'local-llm:qwen3.8-27b' });
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual({ assignment: { slot: 'code', fullId: 'local-llm:qwen3.8-27b', params: {}, updatedAt: '2026-09-24T00:00:00.000Z' } });
        expect(mockPutAssignment).toHaveBeenCalledWith(expect.objectContaining({ scope: '3', slotId: 'code', admin: false }));
    });

    it('사용자 DELETE 는 { deleted: true }', async () => {
        const r = await request(app).delete('/api/users/me/model-assignments/code');
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual({ deleted: true });
    });

    it('관리자 GET/PUT/DELETE 는 전역 scope 로 같은 봉투', async () => {
        expect((await request(app).get('/api/admin/model-assignments')).body.data).toHaveProperty('slots');
        const put = await request(app).put('/api/admin/model-assignments/code').send({ model: 'local-llm:qwen3.8-27b' });
        expect(put.body.data).toHaveProperty('assignment.slot', 'code');
        expect(mockPutAssignment).toHaveBeenLastCalledWith(expect.objectContaining({ scope: '__global__', admin: true }));
        expect((await request(app).delete('/api/admin/model-assignments/code')).body.data).toEqual({ deleted: true });
    });
});
