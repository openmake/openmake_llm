/**
 * 확장 설치 미리보기(M1b) 라우트 — 플래그 OFF 면 404·갤러리 응답에 필드 없음(종전 흐름), ON 이면 미리보기를 낸다.
 * 원본 정책(M2) 거절은 어떤 네트워크 조회보다 먼저 403 EXTENSION_SOURCE_BLOCKED. LLM 은 부르지 않는다(무DB).
 */
import { resetConfig } from '../config/env';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u-1', userId: 'u-1', role: 'user' };
        next();
    },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
// 미리보기는 같은 이름의 기존 설치를 SELECT 로만 읽는다 — 그 밖의 SQL 이 오면 실패
const mockQuery = jest.fn(async (sql: string) => {
    if (!/^\s*SELECT/i.test(sql)) throw new Error(`쓰기 SQL 금지: ${sql}`);
    return { rows: [] };
});
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({ query: mockQuery }), getUnifiedDatabase: () => ({ getPool: () => ({ query: mockQuery }) }) }));
jest.mock('../security/security-audit', () => ({ auditSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../services/org/effective-policy', () => ({ resolveEffectivePolicyStrict: jest.fn(async () => ({ extensionSource: undefined })) }));
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));
jest.mock('../data/retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

const mockGetById = jest.fn();
jest.mock('../data/repositories/extension-catalog-repository', () => ({
    ExtensionCatalogRepository: jest.fn().mockImplementation(() => ({ getById: mockGetById, listEnabled: async () => [] })),
}));
const FILES: Record<string, string> = {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'pv-pack', version: '1.0.0', description: '미리보기' }),
    'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: 알파 스킬\n---\n\n# alpha\n\n본문.\n',
    '.mcp.json': JSON.stringify({ mcpServers: { tool: { command: 'npx', args: ['-y', 'pv-mcp@1.0.0'] } } }),
};
const mockFetcher = {
    resolveRef: jest.fn(async () => 'c'.repeat(40)),
    listTree: jest.fn(async () => ({ sha: 'c'.repeat(40), entries: Object.entries(FILES).map(([path, c]) => ({ path, type: 'blob', size: c.length, sha: 'x' })), truncated: false })),
    fetchFile: jest.fn(async (_o: string, _r: string, _s: string, p: string) => {
        if (!(p in FILES)) throw new Error(`FILE_NOT_FOUND ${p}`);
        return FILES[p];
    }),
};
jest.mock('../agents/git-ingest/git-fetcher', () => ({ GitFetcher: jest.fn().mockImplementation(() => mockFetcher) }));
// ConventionChecker 의 LLM 단계·채팅 LLM — 미리보기는 하나도 부르지 않아야 한다
const mockLlmCtor = jest.fn();
jest.mock('../llm/client', () => ({ LLMClient: jest.fn().mockImplementation((...a: unknown[]) => { mockLlmCtor(...a); return { chat: jest.fn() }; }) }));

import { createUserExtensionsController } from '../controllers/user-extensions.controller';
import { errorHandler } from '../utils/error-handler';
import { resetExtensionSourcePolicyState } from '../services/extensions/source-policy';

const KEYS = ['EXTENSION_INSTALL_PREVIEW_ENABLED', 'EXTENSION_SOURCE_POLICY_ENFORCED', 'EXTENSION_SOURCE_POLICY', 'EXTENSION_INGEST_ENABLED'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function app(): express.Express {
    const a = express();
    a.use(express.json());
    a.use('/api/users/me/extensions', createUserExtensionsController());
    a.use(errorHandler);
    return a;
}

function setEnv(k: (typeof KEYS)[number], v: string | undefined) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
    resetConfig();
}

beforeEach(() => {
    jest.clearAllMocks();
    setEnv('EXTENSION_INGEST_ENABLED', 'true');
    setEnv('EXTENSION_SOURCE_POLICY_ENFORCED', undefined);
    setEnv('EXTENSION_SOURCE_POLICY', undefined);
    mockGetById.mockResolvedValue({ id: 'c1', url: 'https://github.com/pv/pack', enabled: true, plugins: [] });
});
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionSourcePolicyState();
});

describe('플래그 OFF — 종전 흐름', () => {
    beforeEach(() => setEnv('EXTENSION_INSTALL_PREVIEW_ENABLED', undefined));

    it('미리보기 라우트는 404 이고 원본 조회도 하지 않는다', async () => {
        const res = await request(app()).post('/api/users/me/extensions/catalog/c1/preview').send({});
        expect(res.status).toBe(404);
        expect(mockGetById).not.toHaveBeenCalled();
        expect(mockFetcher.resolveRef).not.toHaveBeenCalled();
    });

    it('갤러리 응답에 installPreview 필드가 없다(응답 모양 불변)', async () => {
        const res = await request(app()).get('/api/users/me/extensions/gallery');
        expect(res.status).toBe(200);
        expect(Object.keys(res.body.data).sort()).toEqual(['catalog', 'extensions']);
    });
});

describe('플래그 ON', () => {
    beforeEach(() => setEnv('EXTENSION_INSTALL_PREVIEW_ENABLED', 'true'));

    it('갤러리 응답이 installPreview:true 를 싣는다', async () => {
        const res = await request(app()).get('/api/users/me/extensions/gallery');
        expect(res.body.data.installPreview).toBe(true);
    });

    it('구성요소·권한·원본·커밋·경고를 내고, LLM 0회·쓰기 SQL 0회', async () => {
        const res = await request(app()).post('/api/users/me/extensions/catalog/c1/preview').send({});
        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(Object.keys(d)).toEqual(expect.arrayContaining(['components', 'permissions', 'source', 'commit', 'warnings']));
        expect(d.commit).toBe('c'.repeat(40));
        expect(d.source.url).toBe('https://github.com/pv/pack');
        expect(d.components.skills.map((s: { name: string }) => s.name)).toEqual(['alpha']);
        expect(d.components.mcpServers.map((m: { name: string }) => m.name)).toEqual(['tool']);
        expect(d.permissions).toEqual({ requested: null, blocked: [], state: 'legacy_unreviewed' });
        expect(mockLlmCtor).not.toHaveBeenCalled();
        expect(mockQuery.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql as string))).toBe(true);
    });

    it('원본 정책(M2) 거절은 네트워크 조회 전에 403', async () => {
        setEnv('EXTENSION_SOURCE_POLICY_ENFORCED', 'true');
        setEnv('EXTENSION_SOURCE_POLICY', JSON.stringify({ deny: [{ type: 'github', repo: 'pv/*' }] }));
        const res = await request(app()).post('/api/users/me/extensions/catalog/c1/preview').send({});
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EXTENSION_SOURCE_BLOCKED');
        expect(mockFetcher.resolveRef).not.toHaveBeenCalled();
        expect(mockFetcher.listTree).not.toHaveBeenCalled();
    });
});
