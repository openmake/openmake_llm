/**
 * skills.routes — POST /api/agents/skills/upload: 인증 → multer(file) → 검증·저장, mcp_bundles 안내.
 * mcp_bundles 는 기록만 되고 실행되지 않으므로 응답 compat_notes 에 그 사실을 싣는다.
 * DB·도구 목록·importer 만 가짜로 두고 매니페스트 파싱·검증은 실제 코드를 탄다.
 */
import express from 'express';
import request from 'supertest';

type TestReq = { headers: Record<string, string | undefined>; user?: unknown };
type TestRes = { status: (n: number) => { json: (b: unknown) => void } };

jest.mock('../../../auth', () => ({
    optionalAuth: (_req: TestReq, _res: TestRes, next: () => void) => next(),
    requireAuth: (req: TestReq, res: TestRes, next: () => void) => {
        if (!req.headers['x-test-user']) { res.status(401).json({}); return; }
        req.user = { userId: req.headers['x-test-user'], role: 'user' };
        next();
    },
    requireAdmin: (_req: TestReq, res: TestRes) => { res.status(403).json({}); },
}));

const importMock = jest.fn();
jest.mock('../manifest-importer', () => ({
    ManifestImporter: jest.fn().mockImplementation(() => ({ import: (...a: unknown[]) => importMock(...a) })),
}));
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({}) }),
}));
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    getToolRuntime: () => ({ listLLMTools: async () => [{ function: { name: 'web_search' } }] }),
}));

import skillsRouter from '../routes/skills.routes';

const app = express();
app.use('/api/agents/skills', skillsRouter);

function skillFile(extraFrontmatter = ''): Buffer {
    return Buffer.from(
        `---\nname: Repo Helper\ndescription: test skill\nversion: 1.0.0\n${extraFrontmatter}---\n\n# Repo Helper\n\n본문입니다.\n`,
        'utf-8',
    );
}

const post = () => request(app).post('/api/agents/skills/upload');

beforeEach(() => {
    importMock.mockReset();
    importMock.mockResolvedValue({ skill_id: 'user-42-repo-helper', version: '1.0.0', inserted: true, duplicate_checksum: false });
});

describe('POST /api/agents/skills/upload', () => {
    it('인증이 없으면 저장하지 않는다', async () => {
        const res = await post().attach('file', skillFile(), 'skill.md');
        expect(res.status).toBe(401);
        expect(importMock).not.toHaveBeenCalled();
    });

    it('file 이 없으면 400', async () => {
        const res = await post().set('x-test-user', '42');
        expect(res.status).toBe(400);
        expect(importMock).not.toHaveBeenCalled();
    });

    it('mcp_bundles 가 없으면 저장 후 201, 실행 안내는 없다', async () => {
        const res = await post().set('x-test-user', '42').attach('file', skillFile(), 'skill.md');
        expect(res.status).toBe(201);
        expect(importMock).toHaveBeenCalledTimes(1);
        expect(res.body.data).toMatchObject({ skill_id: 'user-42-repo-helper', bundles_count: 0 });
        expect((res.body.data.compat_notes as string[]).some((n) => n.includes('mcp_bundles'))).toBe(false);
    });

    it('mcp_bundles 가 있으면 기록은 하되 실행되지 않는다고 compat_notes 에 알린다', async () => {
        const res = await post().set('x-test-user', '42').attach('file', skillFile(
            'mcp_bundles:\n  - server_name: github\n    server_config:\n      transport_type: stdio\n      command: npx\n',
        ), 'skill.md');
        expect(res.status).toBe(201);
        expect(importMock.mock.calls[0][0].manifest.mcp_bundles).toHaveLength(1);
        expect(res.body.data.bundles_count).toBe(1);
        expect(res.body.data.compat_notes).toContainEqual(
            expect.stringContaining('mcp_bundles 1개(github)는 기록만 되고 실행되지 않습니다'),
        );
    });
});
