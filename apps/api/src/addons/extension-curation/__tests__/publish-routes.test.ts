/**
 * 큐레이션 add-on — 내부 게시 `/api/marketplace` (§8-2 이전, 무DB). 종전 Base 라우트와 같은 경로·응답:
 * 후보 목록, 번들 저장 → 소유자 확장 행(`internal://bundle/<id>`) 생성·갱신·이름 충돌 409, 잘못된 이름 400, 감사 기록.
 * 번들 빌더는 실물을 쓴다(파일 접두 벗김까지 고정).
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.mock('../../../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: 'u-1', userId: 'u-1', role: 'user' };
        next();
    },
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const SKILL = { id: 's1', name: 'alpha', description: '알파', content: '# alpha\n본문', category: null, tags: [], triggers: null };
const exportRepo = {
    getCandidatesSafe: jest.fn(async () => ({ skills: [{ id: 's1' }], agents: [], mcpServers: [] })),
    getSkills: jest.fn(async (_u: string, ids: string[]) => (ids.includes('s1') ? [SKILL] : [])),
    getAgents: jest.fn(async () => []),
    getMcpServers: jest.fn(async () => []),
    getSkillAssets: jest.fn(async () => []),
};
jest.mock('../../../data/repositories/marketplace-export-repository', () => ({ MarketplaceExportRepository: jest.fn().mockImplementation(() => exportRepo) }));
const bundleRepo = { upsert: jest.fn(async (i: { name: string; version: string }) => ({ id: 'b1', sha: 'f'.repeat(40), version: i.version })) };
jest.mock('../../../data/repositories/marketplace-bundle-repository', () => ({ MarketplaceBundleRepository: jest.fn().mockImplementation(() => bundleRepo) }));
const extRepo = {
    findActiveByName: jest.fn(),
    insert: jest.fn(async () => ({ id: 'e1', visibility: 'private' })),
    updateAfterReinstall: jest.fn(async () => ({ id: 'e1', visibility: 'shared' })),
    setVisibility: jest.fn(async () => ({ id: 'e1', visibility: 'shared' })),
};
jest.mock('../../../data/repositories/user-extension-repository', () => ({ UserExtensionRepository: jest.fn().mockImplementation(() => extRepo) }));
const mockLogAudit = jest.fn(async () => undefined);
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: mockLogAudit }) }));

import { createMarketplacePublishRouter } from '../publish-routes';

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/marketplace', createMarketplacePublishRouter());
    return a;
}

beforeEach(() => {
    jest.clearAllMocks();
    extRepo.findActiveByName.mockResolvedValue(null);
});

describe('/api/marketplace', () => {
    it('GET /publish/candidates — 요청자 후보 그대로', async () => {
        const res = await request(app()).get('/api/marketplace/publish/candidates');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ skills: [{ id: 's1' }], agents: [], mcpServers: [] });
        expect(exportRepo.getCandidatesSafe).toHaveBeenCalledWith('u-1');
    });

    it('POST /publish — 번들을 루트 경로로 저장하고 내부 번들을 가리키는 확장 행을 만들어 공유한다, 빠진 id 는 missing', async () => {
        const res = await request(app()).post('/api/marketplace/publish').send({ pluginName: 'my-pack', skillIds: ['s1', 'gone'] });
        expect(res.status).toBe(200);
        const files = (bundleRepo.upsert.mock.calls[0] as unknown as [{ files: { path: string }[] }])[0].files.map((f) => f.path);
        expect(files).toContain('.claude-plugin/plugin.json');
        expect(files.every((p) => !p.startsWith('plugins/'))).toBe(true);
        expect(extRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1', name: 'my-pack', sourceUrl: 'internal://bundle/b1', sourceRef: 'f'.repeat(40) }));
        expect(extRepo.setVisibility).toHaveBeenCalledWith('e1', 'u-1', 'shared');
        expect(res.body.data).toMatchObject({ bundleId: 'b1', extensionId: 'e1', visibility: 'shared', plugin: 'my-pack', missing: { skills: ['gone'], agents: [], mcpServers: [] } });
        expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'marketplace.publish', resourceType: 'marketplace_bundle', resourceId: 'b1', userId: 'u-1' }));
    });

    it('같은 번들 재게시는 기존 행 갱신, 다른 원본의 같은 이름은 409', async () => {
        extRepo.findActiveByName.mockResolvedValueOnce({ id: 'e1', source_url: 'internal://bundle/b1' });
        const again = await request(app()).post('/api/marketplace/publish').send({ pluginName: 'my-pack', skillIds: ['s1'] });
        expect(again.status).toBe(200);
        expect(extRepo.updateAfterReinstall).toHaveBeenCalled();
        expect(extRepo.insert).not.toHaveBeenCalled();
        extRepo.findActiveByName.mockResolvedValueOnce({ id: 'e2', source_url: 'https://github.com/x/y' });
        const clash = await request(app()).post('/api/marketplace/publish').send({ pluginName: 'my-pack', skillIds: ['s1'] });
        expect(clash.status).toBe(409);
    });

    it('규격 밖 이름은 400 — 저장하지 않는다', async () => {
        const res = await request(app()).post('/api/marketplace/publish').send({ pluginName: 'Bad Name!' });
        expect(res.status).toBe(400);
        expect(bundleRepo.upsert).not.toHaveBeenCalled();
    });
});
