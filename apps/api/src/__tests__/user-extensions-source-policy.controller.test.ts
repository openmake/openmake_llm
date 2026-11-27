/**
 * 확장 원본 정책(M2) 거절은 갤러리·카탈로그 라우트의 400 변환을 타지 않고 403 EXTENSION_SOURCE_BLOCKED 로 나간다(무DB).
 * 카탈로그 등록 실패는 원본 정책 거절이 저장 전에 일어나 카탈로그 행을 만들지 않는다.
 */
import { resetConfig } from '../config/env';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'admin-1', userId: 'admin-1', role: 'admin' };
        next();
    },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../security/security-audit', () => ({ auditSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../services/org/effective-policy', () => ({ resolveEffectivePolicyStrict: jest.fn(async () => ({ extensionSource: undefined })) }));
jest.mock('../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));

const mockInsert = jest.fn();
const mockGetById = jest.fn();
jest.mock('../data/repositories/extension-catalog-repository', () => ({
    ExtensionCatalogRepository: jest.fn().mockImplementation(() => ({
        findByUrl: async () => null,
        insert: mockInsert,
        getById: mockGetById,
        listEnabled: async () => [],
    })),
}));
const mockFetcherFactory = jest.fn();
jest.mock('../agents/git-ingest/git-fetcher', () => ({ GitFetcher: jest.fn().mockImplementation(() => mockFetcherFactory()) }));

import { createUserExtensionsController } from '../controllers/user-extensions.controller';
import { errorHandler } from '../utils/error-handler';
import { resetExtensionSourcePolicyState } from '../services/extensions/source-policy';

const KEYS = ['EXTENSION_SOURCE_POLICY_ENFORCED', 'EXTENSION_SOURCE_POLICY', 'EXTENSION_INGEST_ENABLED'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function app(): express.Express {
    const a = express();
    a.use(express.json());
    a.use('/api/users/me/extensions', createUserExtensionsController());
    a.use(errorHandler);
    return a;
}

beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'true'; resetConfig();
    process.env.EXTENSION_SOURCE_POLICY = JSON.stringify({ deny: [{ type: 'github', repo: 'evil/*' }] }); resetConfig();
    process.env.EXTENSION_INGEST_ENABLED = 'true'; resetConfig();
});
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionSourcePolicyState();
});

it('카탈로그 등록: 차단 원본 → 403 EXTENSION_SOURCE_BLOCKED, 원격 조회·저장 0', async () => {
    const res = await request(app()).post('/api/users/me/extensions/catalog').send({ url: 'https://github.com/evil/market' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EXTENSION_SOURCE_BLOCKED');
    expect(mockFetcherFactory).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
});

it('카탈로그 설치: 등록된 원본이 이후 차단되면 403', async () => {
    mockGetById.mockResolvedValue({ id: 'c1', url: 'https://github.com/evil/market', enabled: true, plugins: [] });
    const res = await request(app()).post('/api/users/me/extensions/catalog/c1/install').send({ plugin: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EXTENSION_SOURCE_BLOCKED');
    expect(mockFetcherFactory).not.toHaveBeenCalled();
});
