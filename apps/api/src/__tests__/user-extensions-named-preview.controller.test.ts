/**
 * 이름 설치 미리보기 `POST /preview-by-name` — 플래그 OFF 면 404 이고 `/install-by-name` 은 종전처럼 바로 설치한다.
 * ON 이면 설치와 같은 해석·같은 설치 입력으로 미리보기(LLM 0회·쓰기 SQL 0회), 모르는 이름은 후보만 400.
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
const mockListEnabled = jest.fn();
jest.mock('../data/repositories/extension-catalog-repository', () => ({
    ExtensionCatalogRepository: jest.fn().mockImplementation(() => ({ getById: mockGetById, listEnabled: mockListEnabled })),
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
    mockListEnabled.mockResolvedValue([{ id: 'c1', url: 'https://github.com/pv/pack', alias: 'pvm', name: 'pvm', enabled: true, source_subpath: null, plugins: [{ name: 'pv-pack' }] }]);
});
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionSourcePolicyState();
});

import { ExtensionIngestService } from '../agents/git-ingest/extension-ingest-service';

const PREVIEW = '/api/users/me/extensions/preview-by-name';
const INSTALL = '/api/users/me/extensions/install-by-name';

describe('플래그 OFF — 종전 흐름', () => {
    beforeEach(() => setEnv('EXTENSION_INSTALL_PREVIEW_ENABLED', undefined));

    it('미리보기 라우트는 404 이고 카탈로그·원본 조회도 하지 않는다', async () => {
        const res = await request(app()).post(PREVIEW).send({ ref: 'pv-pack@pvm' });
        expect(res.status).toBe(404);
        expect(mockListEnabled).not.toHaveBeenCalled();
        expect(mockFetcher.resolveRef).not.toHaveBeenCalled();
    });

    it('/install-by-name 은 미리보기 없이 바로 설치 엔진을 부른다', async () => {
        const importSpy = jest.spyOn(ExtensionIngestService.prototype, 'import').mockResolvedValue({ extensionId: 'e1', name: 'pv-pack', version: '1.0.0' } as never);
        const previewSpy = jest.spyOn(ExtensionIngestService.prototype, 'preview');
        const res = await request(app()).post(INSTALL).send({ ref: 'pv-pack@pvm' });
        expect(res.status).toBe(200);
        expect(importSpy).toHaveBeenCalledTimes(1);
        expect(previewSpy).not.toHaveBeenCalled();
        importSpy.mockRestore(); previewSpy.mockRestore();
    });
});

describe('플래그 ON', () => {
    beforeEach(() => setEnv('EXTENSION_INSTALL_PREVIEW_ENABLED', 'true'));

    it('구성요소·원본·커밋을 내고, LLM 0회·쓰기 SQL 0회', async () => {
        const res = await request(app()).post(PREVIEW).send({ ref: 'pv-pack@pvm' });
        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(d.source.url).toBe('https://github.com/pv/pack');
        expect(d.commit).toBe('c'.repeat(40));
        expect(d.components.skills.map((s: { name: string }) => s.name)).toEqual(['alpha']);
        expect(d.components.mcpServers.map((m: { name: string }) => m.name)).toEqual(['tool']);
        expect(d.namedSource).toEqual({ id: 'c1', marketplace: 'pvm', plugin: 'pv-pack' });
        expect(mockLlmCtor).not.toHaveBeenCalled();
        expect(mockQuery.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql as string))).toBe(true);
    });

    it('미리보기와 설치는 같은 설치 엔진 입력을 쓴다(pinEntrySha·하위 경로·isAdmin=false)', async () => {
        const previewSpy = jest.spyOn(ExtensionIngestService.prototype, 'preview');
        const importSpy = jest.spyOn(ExtensionIngestService.prototype, 'import').mockResolvedValue({ extensionId: 'e1', name: 'pv-pack', version: '1.0.0' } as never);
        await request(app()).post(PREVIEW).send({ ref: 'pv-pack@pvm' });
        await request(app()).post(INSTALL).send({ ref: 'pv-pack@pvm' });
        expect(previewSpy.mock.calls[0][0]).toEqual(importSpy.mock.calls[0][0]);
        expect(previewSpy.mock.calls[0][0]).toMatchObject({ userId: 'u-1', isAdmin: false, gitUrl: 'https://github.com/pv/pack', plugin: 'pv-pack', pinEntrySha: true });
        previewSpy.mockRestore(); importSpy.mockRestore();
    });

    it('모르는 플러그인은 후보만 400 (원본 조회 없음)', async () => {
        const res = await request(app()).post(PREVIEW).send({ ref: 'pv-pak@pvm' });
        expect(res.status).toBe(400);
        expect(res.body.error.details.code).toBe('NAMED_INSTALL_UNKNOWN_PLUGIN');
        expect(res.body.error.details.candidates).toEqual(['pv-pack@pvm']);
        expect(mockFetcher.resolveRef).not.toHaveBeenCalled();
    });

    it('모르는 마켓플레이스도 후보만 400', async () => {
        const res = await request(app()).post(PREVIEW).send({ ref: 'pv-pack@pvx' });
        expect(res.status).toBe(400);
        expect(res.body.error.details.code).toBe('NAMED_INSTALL_UNKNOWN_MARKETPLACE');
        expect(res.body.error.details.candidates).toEqual(['pv-pack@pvm']);
    });

    it('원본 정책(M2) 거절은 네트워크 조회 전에 403', async () => {
        setEnv('EXTENSION_SOURCE_POLICY_ENFORCED', 'true');
        setEnv('EXTENSION_SOURCE_POLICY', JSON.stringify({ deny: [{ type: 'github', repo: 'pv/*' }] }));
        const res = await request(app()).post(PREVIEW).send({ ref: 'pv-pack@pvm' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EXTENSION_SOURCE_BLOCKED');
        expect(mockFetcher.resolveRef).not.toHaveBeenCalled();
    });
});
