/**
 * Artifact Export Routes — html 아티팩트의 pdf/docx 변환 (P1 보고서 파이프라인 Phase 3).
 *
 * artifacts.routes 에서 분리(파일 크기 가드). 변환 본체는
 * services/report/artifact-export-service (Docker 샌드박스) 가 담당.
 *
 * @module routes/artifact-export.routes
 */
import { Router, Request, Response } from 'express';
import { ArtifactRepository } from '../data/repositories/artifact-repository';
import { getPool, getUnifiedDatabase } from '../data/models/unified-database';
import { success, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';
import { artifactExportLimiter } from '../middlewares/rate-limiters';
import {
    exportArtifactPdf,
    exportArtifactDocx,
    ArtifactExportError,
    type ExportFormat,
} from '../services/report/artifact-export-service';
import { getAuditService } from '../services/AuditService';

const router = Router();

/**
 * POST /api/sessions/:sid/artifacts/:aid/export
 * body: { format: 'pdf' | 'docx' }
 * 응답: { filename, mime, dataBase64, durationMs } — 프론트가 blob 으로 다운로드.
 *
 * - pdf: 최신 버전의 html content 를 chromium headless print (모든 html 아티팩트 가능)
 * - docx: reportdata source_data 에서 python-docx 생성 (보고서 아티팩트만 — 없으면 409)
 * 보안: requireAuth + 소유자/admin + rate limit + network none 컨테이너 + audit.
 */
router.post('/sessions/:sid/artifacts/:aid/export', requireAuth, artifactExportLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { sid, aid } = req.params;
    const format = (req.body as { format?: unknown })?.format;
    if (format !== 'pdf' && format !== 'docx') {
        res.status(400).json({ error: 'INVALID_FORMAT', detail: "format 은 'pdf' | 'docx'" });
        return;
    }

    const repo = new ArtifactRepository(getPool());
    const versions = await repo.listVersionsByArtifactId(sid, aid);
    if (versions.length === 0) {
        res.status(404).json(notFound('artifact'));
        return;
    }
    const userId = req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString();
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin && versions[0].user_id !== userId) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }
    const latest = versions[versions.length - 1];

    try {
        let result;
        if (format === 'pdf') {
            if (latest.kind !== 'html' && latest.kind !== 'svg') {
                res.status(409).json({ error: 'UNSUPPORTED_KIND', detail: 'pdf 변환은 html/svg 아티팩트만 지원합니다' });
                return;
            }
            result = await exportArtifactPdf(latest.content);
        } else {
            const sourceData = await repo.getLatestSourceData(sid, aid);
            if (!sourceData) {
                res.status(409).json({ error: 'NO_SOURCE_DATA', detail: 'docx 변환은 보고서 아티팩트(reportdata 원본 보유)만 지원합니다' });
                return;
            }
            result = await exportArtifactDocx(sourceData);
        }

        void getAuditService().logAudit({
            action: 'artifact_export',
            userId,
            details: {
                sessionId: sid, artifactId: aid, format: format as ExportFormat,
                durationMs: result.durationMs, outputChars: result.dataBase64.length,
            },
            actor: { email: req.user?.email, role: req.user?.role },
        });

        const safeBase = (latest.title || aid).replace(/[\\/:*?"<>|\n\r]+/g, '_').slice(0, 80) || 'artifact';
        res.json(success({
            filename: `${safeBase}.${format}`,
            mime: result.mime,
            dataBase64: result.dataBase64,
            durationMs: result.durationMs,
        }));
    } catch (e) {
        if (e instanceof ArtifactExportError) {
            res.status(e.statusCode).json({ error: e.code, detail: e.message });
            return;
        }
        throw e;
    }
}));

/**
 * POST /api/agent-tasks/:taskId/artifacts/:aid/export
 * body: { format: 'pdf' | 'docx' }
 *
 * Agent Task 산출물(step_type='artifact' — artifacts 테이블이 아닌 스텝 JSON) export.
 * docx 는 스텝 JSON 에 동봉된 reportdata 원본(sourceData — persistArtifactSteps)이 필요.
 * 소유권은 task.user_id 기준 (채팅 세션과 무관).
 */
router.post('/agent-tasks/:taskId/artifacts/:aid/export', requireAuth, artifactExportLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { taskId, aid } = req.params;
    const format = (req.body as { format?: unknown })?.format;
    if (format !== 'pdf' && format !== 'docx') {
        res.status(400).json({ error: 'INVALID_FORMAT', detail: "format 은 'pdf' | 'docx'" });
        return;
    }

    const db = getUnifiedDatabase();
    const task = await db.getAgentTask(taskId);
    if (!task) {
        res.status(404).json(notFound('task'));
        return;
    }
    const userId = req.user && 'userId' in req.user ? (req.user as { userId: string }).userId : req.user?.id?.toString();
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin && String(task.user_id) !== String(userId)) {
        res.status(403).json({ error: 'FORBIDDEN', detail: 'not owner' });
        return;
    }

    const steps = await db.getAgentTaskSteps(taskId);
    let found: { kind?: string; content?: string; sourceData?: Record<string, unknown> } | null = null;
    for (const s of steps) {
        if (s.step_type !== 'artifact') continue;
        try {
            const a = JSON.parse(String(s.content ?? ''));
            if (a && a.id === aid) { found = a; break; }
        } catch { /* 파싱 불가 스텝 skip */ }
    }
    if (!found) {
        res.status(404).json(notFound('task artifact'));
        return;
    }

    try {
        let result;
        if (format === 'pdf') {
            if (found.kind !== 'html' && found.kind !== 'svg') {
                res.status(409).json({ error: 'UNSUPPORTED_KIND', detail: 'pdf 변환은 html/svg 아티팩트만 지원합니다' });
                return;
            }
            result = await exportArtifactPdf(String(found.content ?? ''));
        } else {
            if (!found.sourceData) {
                res.status(409).json({ error: 'NO_SOURCE_DATA', detail: 'docx 변환은 보고서 아티팩트(reportdata 원본 보유)만 지원합니다' });
                return;
            }
            result = await exportArtifactDocx(found.sourceData);
        }

        void getAuditService().logAudit({
            action: 'artifact_export',
            userId,
            details: { taskId, artifactId: aid, format: format as ExportFormat, durationMs: result.durationMs },
            actor: { email: req.user?.email, role: req.user?.role },
        });

        const title = (found as { title?: string }).title || aid;
        const safeBase = title.replace(/[\\/:*?"<>|\n\r]+/g, '_').slice(0, 80) || 'artifact';
        res.json(success({
            filename: `${safeBase}.${format}`,
            mime: result.mime,
            dataBase64: result.dataBase64,
            durationMs: result.durationMs,
        }));
    } catch (e) {
        if (e instanceof ArtifactExportError) {
            res.status(e.statusCode).json({ error: e.code, detail: e.message });
            return;
        }
        throw e;
    }
}));

export default router;
