/**
 * workspace 파일 다운로드 — 설치본은 workspace 를 점 폴더(`~/.openmake/<환경>/task-workspaces`) 아래에 둔다.
 * send 는 root 없이 받은 절대경로의 모든 조각에서 점 파일을 찾아 404 로 답하므로, 조상 폴더 이름 때문에
 * 멀쩡한 파일이 내려가지 않았다. 실제 응답 스트림을 타야 재현되므로 supertest 로 라우터를 통째로 태운다.
 */
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const getAgentTask = jest.fn();
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getAgentTask }),
    getPool: () => ({}),
}));
jest.mock('../../auth/ownership', () => ({ assertResourceOwnerOrAdmin: jest.fn() }));
jest.mock('../../middlewares/api-key-auth', () => ({
    requireAuthOrApiKeyScope: () => (req: any, _res: any, next: any) => { req.user = { id: 'u1', role: 'user' }; next(); },
}));

import router from '../agent-task.routes';

const app = express().use('/api/agent-tasks', router);
let base: string;

beforeAll(() => { base = mkdtempSync(join(tmpdir(), 'omk-dl-')); });
afterAll(() => { rmSync(base, { recursive: true, force: true }); });

function workspaceUnder(...parents: string[]): string {
    const wp = join(base, ...parents, 'task-1');
    mkdirSync(join(wp, 'out'), { recursive: true });
    writeFileSync(join(wp, 'out', 'result.txt'), 'hello');
    writeFileSync(join(wp, '.env'), 'SECRET=1');
    getAgentTask.mockResolvedValue({ id: 'task-1', user_id: 'u1', workspace_path: wp });
    return wp;
}
const download = (path: string) => request(app).get('/api/agent-tasks/task-1/files/download').query({ path });

describe('GET /:taskId/files/download', () => {
    it('workspace 가 점 폴더 아래에 있어도 파일을 내려준다', async () => {
        workspaceUnder('.openmake', 'staging', 'task-workspaces');
        const res = await download('out/result.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('hello');
        expect(res.headers['content-disposition']).toContain('result.txt');
    });
    it('점 폴더가 없는 workspace 도 그대로 내려준다', async () => {
        workspaceUnder('plain');
        const res = await download('out/result.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('hello');
    });
    it('workspace 안의 점 파일은 내려주지 않는다', async () => {
        workspaceUnder('.openmake', 'staging', 'task-workspaces');
        expect((await download('.env')).status).toBe(404);
    });
    it('workspace 밖 경로는 400', async () => {
        workspaceUnder('plain');
        expect((await download('../../etc/passwd')).status).toBe(400);
    });
});
