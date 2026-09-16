/**
 * 아티팩트 export 라우트 — 포맷 검증(pdf/docx/xlsx), csv xlsx 는 source_data 를 조회하지 않음, 409 응답 전달.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const listVersionsByArtifactId = jest.fn();
const getLatestSourceData = jest.fn();
jest.mock('../../data/repositories/artifact-repository', () => ({ ArtifactRepository: jest.fn().mockImplementation(() => ({ listVersionsByArtifactId, getLatestSourceData })) }));
const getAgentTask = jest.fn();
const getAgentTaskSteps = jest.fn();
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ getAgentTask, getAgentTaskSteps }) }));
jest.mock('../../auth', () => ({ requireAuth: (req: Request, _res: Response, next: NextFunction) => { (req as any).user = { id: 'u1', role: 'user' }; next(); } }));
jest.mock('../../middlewares/rate-limiters', () => ({ artifactExportLimiter: (_req: Request, _res: Response, next: NextFunction) => next() }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: async () => undefined }) }));
const exportByFormat = jest.fn();
jest.mock('../../services/report/artifact-export-service', () => {
    const actual = jest.requireActual('../../services/report/artifact-export-service');
    return { ...actual, exportByFormat: (...a: unknown[]) => exportByFormat(...a) };
});

import router from '../artifact-export.routes';
import { ExportUnsupportedError } from '../../services/report/artifact-export-service';

const app = () => { const a = express(); a.use(express.json()); a.use('/api', router); return a; };
const ok = { format: 'xlsx', mime: 'application/x', dataBase64: 'QQ==', durationMs: 5 };

beforeEach(() => {
    jest.clearAllMocks();
    listVersionsByArtifactId.mockResolvedValue([{ user_id: 'u1', kind: 'csv', content: 'a,b', title: '표' }]);
    exportByFormat.mockResolvedValue(ok);
});

describe('POST /api/sessions/:sid/artifacts/:aid/export', () => {
    it('모르는 포맷은 400', async () => {
        const r = await request(app()).post('/api/sessions/s1/artifacts/a1/export').send({ format: 'csv' });
        expect(r.status).toBe(400);
        expect(r.body.detail).toContain('xlsx');
    });

    it('csv 의 xlsx 는 source_data 를 조회하지 않고 변환해 파일명 확장자를 붙인다', async () => {
        const r = await request(app()).post('/api/sessions/s1/artifacts/a1/export').send({ format: 'xlsx' });
        expect(r.status).toBe(200);
        expect(getLatestSourceData).not.toHaveBeenCalled();
        expect(exportByFormat).toHaveBeenCalledWith('xlsx', expect.objectContaining({ kind: 'csv' }), null);
        expect(r.body.data.filename).toBe('표.xlsx');
    });

    it('html 의 xlsx·docx 는 source_data 를 조회해 넘기고, 409 는 코드 그대로 응답', async () => {
        listVersionsByArtifactId.mockResolvedValue([{ user_id: 'u1', kind: 'html', content: '<p/>', title: 'r' }]);
        getLatestSourceData.mockResolvedValue(null);
        exportByFormat.mockRejectedValueOnce(new ExportUnsupportedError('no', 409, 'NO_SOURCE_DATA'));
        const r = await request(app()).post('/api/sessions/s1/artifacts/a1/export').send({ format: 'xlsx' });
        expect(getLatestSourceData).toHaveBeenCalledWith('s1', 'a1');
        expect(r.status).toBe(409);
        expect(r.body.error).toBe('NO_SOURCE_DATA');
    });
});

describe('POST /api/agent-tasks/:taskId/artifacts/:aid/export', () => {
    it('작업 산출물 csv 도 xlsx 로 변환한다', async () => {
        getAgentTask.mockResolvedValue({ id: 't1', user_id: 'u1' });
        getAgentTaskSteps.mockResolvedValue([{ step_type: 'artifact', content: JSON.stringify({ id: 'a1', kind: 'csv', content: 'x,y', title: 'T' }) }]);
        const r = await request(app()).post('/api/agent-tasks/t1/artifacts/a1/export').send({ format: 'xlsx' });
        expect(r.status).toBe(200);
        expect(exportByFormat).toHaveBeenCalledWith('xlsx', expect.objectContaining({ kind: 'csv', content: 'x,y' }), undefined);
    });
});
