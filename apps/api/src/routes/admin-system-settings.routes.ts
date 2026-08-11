/**
 * @module routes/admin-system-settings
 * @description 운영 설정(system_settings) 관리 — admin 전용.
 *
 * 엔드포인트 (모두 requireAuth + requireAdmin, /api/admin 전역 adminLimiter 적용):
 *   GET    /api/admin/system-settings       — 전체 설정 뷰 (시크릿 값 미포함, 출처 뱃지용 source)
 *   PUT    /api/admin/system-settings       — 일괄 저장 (body: { entries: { KEY: value } })
 *   DELETE /api/admin/system-settings/:key  — 삭제 (env/기본값 폴백 복귀)
 *
 * 허용 키는 config/system-settings-registry.ts 화이트리스트 — 그 외 400.
 * 변경은 logAudit 기록 (details 에 키 목록만, 값 절대 미포함) — CRITICAL_ACTIONS
 * 등록으로 운영 webhook 자동 알림.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, notFound } from '../utils/api-response';
import { getSystemSettingsService } from '../services/system-settings-service';
import { SETTING_DEFS_BY_KEY } from '../config/system-settings-registry';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';

const logger = createLogger('AdminSystemSettingsRoutes');

/** 한 번에 저장 가능한 설정 수 상한 — registry 전체(현 24종)보다 넉넉한 방어값 */
const MAX_ENTRIES_PER_REQUEST = 50;

const putSettingsSchema = z.object({
    entries: z.record(z.string().max(100), z.string().max(2000)),
});

function adminUserId(req: Request): string | null {
    return req.user?.id !== undefined ? String(req.user.id) : null;
}

async function auditChange(req: Request, action: string, details: Record<string, unknown>): Promise<void> {
    try {
        await getAuditService().logAudit({
            action,
            userId: adminUserId(req) ?? undefined,
            resourceType: 'system_settings',
            details,
        });
    } catch (err) {
        // 감사 실패가 저장 자체를 되돌리진 않지만, 애플리케이션 로그로 복원 가능하게 남긴다.
        logger.error('시스템 설정 감사 기록 실패 (변경은 반영됨):', { action, details, err });
    }
}

export const adminSystemSettingsRouter = Router();
adminSystemSettingsRouter.use(requireAuth, requireAdmin);

adminSystemSettingsRouter.get('/system-settings', asyncHandler(async (_req: Request, res: Response) => {
    res.json(success({ settings: getSystemSettingsService().describe() }));
}));

adminSystemSettingsRouter.put('/system-settings', validate(putSettingsSchema), asyncHandler(async (req: Request, res: Response) => {
    const { entries } = req.body as z.infer<typeof putSettingsSchema>;
    const keys = Object.keys(entries);
    if (keys.length === 0) {
        res.status(400).json(badRequest('저장할 설정이 없습니다'));
        return;
    }
    if (keys.length > MAX_ENTRIES_PER_REQUEST) {
        res.status(400).json(badRequest(`설정은 요청당 최대 ${MAX_ENTRIES_PER_REQUEST}건입니다`));
        return;
    }

    // 키 화이트리스트 + 키별 형식 검증 (registry validate 는 trim 변환 포함)
    const validated: Record<string, string> = {};
    for (const [key, raw] of Object.entries(entries)) {
        const def = SETTING_DEFS_BY_KEY.get(key);
        if (!def) {
            res.status(400).json(badRequest(`허용되지 않은 설정 키: '${key}'`));
            return;
        }
        const parsed = def.validate.safeParse(raw);
        if (!parsed.success) {
            const message = parsed.error.issues[0]?.message ?? '형식 오류';
            res.status(400).json(badRequest(`'${key}': ${message}`));
            return;
        }
        validated[key] = parsed.data;
    }

    const { requiresRestart } = await getSystemSettingsService().update(validated, adminUserId(req));
    // details 에는 키 목록만 — 시크릿 포함 값은 절대 기록하지 않는다
    await auditChange(req, 'system_settings.updated', { keys: Object.keys(validated), requiresRestart });
    logger.info(`시스템 설정 저장: ${Object.keys(validated).join(', ')}`);
    res.json(success({ settings: getSystemSettingsService().describe(), requiresRestart }));
}));

adminSystemSettingsRouter.delete('/system-settings/:key', asyncHandler(async (req: Request, res: Response) => {
    const key = req.params.key;
    if (!SETTING_DEFS_BY_KEY.has(key)) {
        res.status(400).json(badRequest(`허용되지 않은 설정 키: '${key}'`));
        return;
    }
    const deleted = await getSystemSettingsService().reset(key);
    if (!deleted) {
        res.status(404).json(notFound(`DB 에 설정되지 않은 키: '${key}' (이미 env/기본값 동작)`));
        return;
    }
    await auditChange(req, 'system_settings.reset', { key });
    logger.info(`시스템 설정 삭제(env 폴백 복귀): ${key}`);
    res.json(success({ settings: getSystemSettingsService().describe() }));
}));
