/**
 * 게시 아티팩트 정적 HTML 내려받기(F20.5 옵션) — 소유자만, 경로는 DB publication_id 로, 파일이 없으면 404.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

let user: { id: string; role: string } = { id: 'u1', role: 'user' };
jest.mock('../../auth', () => {
    const attach = (req: Request, _res: Response, next: NextFunction) => { (req as any).user = user; next(); };
    return { requireAuth: attach, optionalAuth: attach };
});
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const getByPublicationId = jest.fn();
jest.mock('../../data/repositories/artifact-publication-repository', () => ({ ArtifactPublicationRepository: jest.fn().mockImplementation(() => ({ getByPublicationId })) }));
jest.mock('../../services/artifact-viewer-service', () => ({}));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: async () => undefined }) }));
const readFile = jest.fn();
jest.mock('fs', () => ({ ...jest.requireActual('fs'), promises: { ...jest.requireActual('fs').promises, readFile: (...a: unknown[]) => readFile(...a) } }));
jest.mock('../../config/artifact-viewer', () => ({ ARTIFACT_VIEWER: {}, viewerArtifactDir: (id: string) => `/viewer/a/${id}` }));

import router from '../artifact-publication.routes';

const app = () => { const a = express(); a.use('/api', router); return a; };

beforeEach(() => { jest.clearAllMocks(); user = { id: 'u1', role: 'user' }; });

describe('GET /api/artifacts/publications/:pubId/bundle', () => {
    it('소유자는 DB 의 publication_id 경로에서 읽은 html 을 제목 파일명으로 받는다', async () => {
        getByPublicationId.mockResolvedValue({ publication_id: 'pub-1', owner_user_id: 'u1', title: '월간/보고', artifact_id: 'a1' });
        readFile.mockResolvedValue('<html>ok</html>');
        const r = await request(app()).get('/api/artifacts/publications/pub-1/bundle');
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual({ filename: '월간_보고.html', html: '<html>ok</html>' });
        expect(readFile).toHaveBeenCalledWith('/viewer/a/pub-1/index.html', 'utf8');
    });

    it('남의 게시물은 403, 없는 게시물은 404, 파일이 없으면 BUNDLE_NOT_FOUND', async () => {
        getByPublicationId.mockResolvedValueOnce({ publication_id: 'pub-1', owner_user_id: 'u2' });
        expect((await request(app()).get('/api/artifacts/publications/pub-1/bundle')).status).toBe(403);
        getByPublicationId.mockResolvedValueOnce(null);
        expect((await request(app()).get('/api/artifacts/publications/nope/bundle')).status).toBe(404);
        getByPublicationId.mockResolvedValueOnce({ publication_id: 'pub-1', owner_user_id: 'u1' });
        readFile.mockRejectedValueOnce(new Error('ENOENT'));
        const r = await request(app()).get('/api/artifacts/publications/pub-1/bundle');
        expect(r.status).toBe(404);
        expect(r.body.error).toBe('BUNDLE_NOT_FOUND');
        expect(readFile).toHaveBeenCalledTimes(1);
    });
});
