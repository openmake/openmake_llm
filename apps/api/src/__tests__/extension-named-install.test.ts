/**
 * 이름 설치(M5) 진입점 — 채팅 도구 import_extension_from_git(ref·gitUrl 자리)와 REST POST /install-by-name.
 *  - 해석된 원본 URL·plugin·하위 경로·pinEntrySha 로 종전 설치 엔진을 부른다(왕복 없음)
 *  - 모르는 이름은 후보만 안내하고 설치 엔진을 부르지 않는다(자동 치환 없음)
 *  - URL 입력은 종전 인자 그대로(회귀 0)
 *  - 원본 정책(M2) 차단은 종전처럼 403
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u1', userId: 'u1', role: 'user' };
        next();
    },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

const SOURCE = {
    id: 'src-1', url: 'https://github.com/acme/market', name: 'acme', alias: 'team', description: null, enabled: true,
    plugins: [{ name: 'code-review' }, { name: 'lint' }], source_subpath: 'catalogs/team',
    added_by: null, last_synced_at: new Date(0), created_at: new Date(0), updated_at: new Date(0),
};
const mockListEnabled = jest.fn(async () => [SOURCE]);
jest.mock('../data/repositories/extension-catalog-repository', () => {
    const actual = jest.requireActual('../data/repositories/extension-catalog-repository');
    return { ...actual, ExtensionCatalogRepository: jest.fn().mockImplementation(() => ({ listEnabled: mockListEnabled })) };
});

const RESULT = {
    extensionId: 'ext-1', name: 'code-review', version: '1.0.0', description: null, gitUrl: SOURCE.url, gitRef: 'a'.repeat(40),
    gitPath: 'code-review/.claude-plugin/plugin.json', skills: [], mcpServers: [], agents: [], validationWarnings: [], deduped: false,
};
const mockImport = jest.fn(async (..._a: unknown[]): Promise<unknown> => RESULT);
jest.mock('../services/extensions/ingest-service-factory', () => ({
    buildExtensionIngestService: async () => ({ import: mockImport }),
}));
jest.mock('../agents/git-ingest/extension-ingest-service', () => ({
    ExtensionIngestService: jest.fn().mockImplementation(() => ({ import: mockImport })),
}));
jest.mock('../config/constants', () => {
    const actual = jest.requireActual('../config/constants');
    return { ...actual, EXTENSION_INGEST: { ...actual.EXTENSION_INGEST, enabled: true } };
});

import { createUserExtensionsController } from '../controllers/user-extensions.controller';
import { importExtensionFromGitTool } from '../tools/extension-ingest-tool';
import { errorHandler } from '../utils/error-handler';
import { ExtensionSourceBlockedError } from '../errors/extension-source-blocked.error';

function app(): express.Express {
    const a = express();
    a.use(express.json());
    a.use('/api/users/me/extensions', createUserExtensionsController());
    a.use(errorHandler);
    return a;
}
const ctx = { userId: 'u1', role: 'user' } as never;
const textOf = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? '').join('\n');

beforeEach(() => jest.clearAllMocks());

describe('REST POST /install-by-name', () => {
    it('해석된 원본으로 설치 — 하위 경로·고정 커밋 우선', async () => {
        const res = await request(app()).post('/api/users/me/extensions/install-by-name').send({ ref: 'code-review@team' });
        expect(res.status).toBe(200);
        expect(mockImport).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'u1', isAdmin: false, gitUrl: SOURCE.url, plugin: 'code-review', catalogSubpath: 'catalogs/team', pinEntrySha: true,
        }));
        expect(res.body.data).toMatchObject({ extensionId: 'ext-1', source: { id: 'src-1', marketplace: 'team', plugin: 'code-review' } });
    });

    it('모르는 플러그인: 400 + 후보, 설치 엔진 호출 0', async () => {
        const res = await request(app()).post('/api/users/me/extensions/install-by-name').send({ ref: 'code-reviw@team' });
        expect(res.status).toBe(400);
        expect(res.body.error.details).toMatchObject({ code: 'NAMED_INSTALL_UNKNOWN_PLUGIN' });
        expect(res.body.error.details.candidates[0]).toBe('code-review@team');
        expect(mockImport).not.toHaveBeenCalled();
    });

    it('원본 정책(M2) 차단은 403', async () => {
        mockImport.mockRejectedValueOnce(new ExtensionSourceBlockedError({ reason: 'DENIED', source: SOURCE.url }));
        const res = await request(app()).post('/api/users/me/extensions/install-by-name').send({ ref: 'lint@team' });
        expect(res.status).toBe(403);
    });
});

describe('채팅 도구 import_extension_from_git', () => {
    it('ref 인자로 이름 설치', async () => {
        const r = await importExtensionFromGitTool.handler({ ref: 'lint@team' }, ctx);
        expect(r.isError).toBeFalsy();
        expect(mockImport).toHaveBeenCalledWith(expect.objectContaining({ gitUrl: SOURCE.url, plugin: 'lint', pinEntrySha: true, catalogSubpath: 'catalogs/team' }));
    });

    it('gitUrl 자리에 온 이름도 같은 해석', async () => {
        await importExtensionFromGitTool.handler({ gitUrl: 'lint@team' }, ctx);
        expect(mockImport).toHaveBeenCalledWith(expect.objectContaining({ gitUrl: SOURCE.url, plugin: 'lint' }));
    });

    it('URL 입력은 종전 인자 그대로 — 카탈로그 조회 없음', async () => {
        await importExtensionFromGitTool.handler({ gitUrl: 'https://github.com/x/y', plugin: 'p', gitRef: 'main' }, ctx);
        expect(mockListEnabled).not.toHaveBeenCalled();
        const input = (mockImport.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
        expect(input).toMatchObject({ gitUrl: 'https://github.com/x/y', plugin: 'p', gitRef: 'main' });
        expect(input.pinEntrySha).toBeUndefined();
        expect(input.catalogSubpath).toBeUndefined();
    });

    it('모르는 마켓플레이스: 후보 안내, 설치 0', async () => {
        const r = await importExtensionFromGitTool.handler({ ref: 'lint@tem' }, ctx);
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('lint@team');
        expect(mockImport).not.toHaveBeenCalled();
    });

    it('gitUrl·ref 둘 다 없으면 오류', async () => {
        const r = await importExtensionFromGitTool.handler({}, ctx);
        expect(r.isError).toBe(true);
        expect(mockImport).not.toHaveBeenCalled();
    });
});
