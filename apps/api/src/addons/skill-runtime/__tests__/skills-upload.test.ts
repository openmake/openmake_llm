/**
 * POST /api/agents/skills/upload 핸들러 — 검증·저장 흐름과 mcp_bundles 안내.
 * mcp_bundles 는 기록만 되고 실행되지 않으므로 응답 compat_notes 에 그 사실을 싣는다.
 */
const importMock = jest.fn();
jest.mock('../manifest-importer', () => ({
    ManifestImporter: jest.fn().mockImplementation(() => ({ import: importMock })),
}));
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({}) }),
}));
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    getToolRuntime: () => ({ listLLMTools: async () => [{ function: { name: 'web_search' } }] }),
}));

import { uploadSkill } from '../routes/skills-upload';

function fakeRes() {
    const res: Record<string, unknown> & { statusCode?: number; body?: unknown } = {};
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}

function skillFile(extraFrontmatter = ''): Buffer {
    return Buffer.from(
        `---\nname: Repo Helper\ndescription: test skill\nversion: 1.0.0\n${extraFrontmatter}---\n\n# Repo Helper\n\n본문입니다.\n`,
        'utf-8',
    );
}

async function upload(buffer?: Buffer) {
    const res = fakeRes();
    const req = { file: buffer ? { buffer } : undefined, user: { userId: '42', role: 'user' } };
    await uploadSkill(req as never, res as never);
    return res as { statusCode?: number; body?: { data?: Record<string, unknown>; error?: string } };
}

beforeEach(() => {
    importMock.mockReset();
    importMock.mockResolvedValue({ skill_id: 'user-42-repo-helper', version: '1.0.0', inserted: true, duplicate_checksum: false });
});

describe('uploadSkill', () => {
    it('file 이 없으면 400', async () => {
        const res = await upload();
        expect(res.statusCode).toBe(400);
        expect(importMock).not.toHaveBeenCalled();
    });

    it('mcp_bundles 가 없으면 저장 후 201, 실행 안내는 없다', async () => {
        const res = await upload(skillFile());
        expect(res.statusCode).toBe(201);
        expect(importMock).toHaveBeenCalledTimes(1);
        expect(res.body?.data).toMatchObject({ skill_id: 'user-42-repo-helper', bundles_count: 0 });
        const notes = res.body?.data?.compat_notes as string[];
        expect(notes.some((n) => n.includes('mcp_bundles'))).toBe(false);
    });

    it('mcp_bundles 가 있으면 기록은 하되 실행되지 않는다고 compat_notes 에 알린다', async () => {
        const res = await upload(skillFile(
            'mcp_bundles:\n  - server_name: github\n    server_config:\n      transport_type: stdio\n      command: npx\n',
        ));
        expect(res.statusCode).toBe(201);
        expect(importMock.mock.calls[0][0].manifest.mcp_bundles).toHaveLength(1);
        expect(res.body?.data?.bundles_count).toBe(1);
        const notes = res.body?.data?.compat_notes as string[];
        expect(notes).toContainEqual(expect.stringContaining('mcp_bundles 1개(github)는 기록만 되고 실행되지 않습니다'));
    });
});
