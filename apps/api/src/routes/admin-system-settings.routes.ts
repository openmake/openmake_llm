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
import { ADMIN_SYNCED_PROVIDER_KEYS, getProviderCatalogEntry } from '../config/external-providers';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
import { getAuditService } from '../services/AuditService';
import { createLogger } from '../utils/logger';

const logger = createLogger('AdminSystemSettingsRoutes');

let keysRepoInstance: ExternalKeysRepository | null = null;

function getKeysRepo(): ExternalKeysRepository {
    if (!keysRepoInstance) {
        keysRepoInstance = new ExternalKeysRepository(getPool());
    }
    return keysRepoInstance;
}

/**
 * 외부 provider 키(OPENROUTER/OLLAMA_CLOUD/NVIDIA) 저장·삭제를 "관리자 본인"의
 * user_external_api_keys(BYOK) 행으로 연동한다 — 관리자가 admin 화면 한 곳에서만
 * 키를 관리하게 하는 통합 지점. 런타임 키 해석 경로는 기존 사용자별 BYOK 그대로라
 * 다른 사용자에게 이 키가 열리지 않는다 (비용 격리). fail-open — 연동 실패가
 * system_settings 저장 자체를 되돌리지 않는다 (로그로 복구 가능).
 *
 * @param value - 저장 시 평문 키, 삭제 시 null (BYOK 행 deactivate)
 */
async function syncAdminProviderKey(adminId: string | null, settingKey: string, value: string | null): Promise<void> {
    const providerId = ADMIN_SYNCED_PROVIDER_KEYS[settingKey];
    if (!providerId || !adminId) return;
    try {
        const repo = getKeysRepo();
        if (value === null) {
            await repo.deactivate(adminId, providerId);
        } else {
            const entry = getProviderCatalogEntry(providerId);
            if (!entry) return;
            // 카탈로그 sdkType 은 넓은 SdkType — BYOK 테이블은 외부 2종만 허용하므로 내로잉
            if (entry.sdkType !== 'anthropic' && entry.sdkType !== 'openai-compatible') return;
            // 기존 행의 custom baseUrl 보존 — upsert 가 base_url = EXCLUDED.base_url 이라
            // 카탈로그 기본값을 넣으면 BYOK 화면에서 설정한 커스텀 endpoint 가 조용히 되돌아간다.
            const existing = await repo.getByUserAndProvider(adminId, providerId);
            await repo.upsert({
                userId: adminId,
                providerId,
                sdkType: entry.sdkType,
                displayName: entry.displayName,
                baseUrl: existing?.baseUrl ?? entry.defaultBaseUrl ?? null,
                apiKey: value,
            });
            // BYOK 등록 경로(external-keys.routes)와 동일한 캐시 무효화 — stale 모델 목록/가용성 제거
            await repo.invalidateCachedModels(adminId, providerId);
            await repo.clearModelAvailability(adminId, providerId);
        }
        logger.info(`외부 provider 키 연동(${value === null ? 'deactivate' : 'upsert'}): admin=${adminId} provider=${providerId}`);
    } catch (err) {
        logger.error(`외부 provider 키 연동 실패 (system_settings 반영은 유지됨): ${settingKey}`, err);
    }
}

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

adminSystemSettingsRouter.get('/system-settings', asyncHandler(async (req: Request, res: Response) => {
    const settings = getSystemSettingsService().describe();
    // 외부 provider 연동 키: 조회한 관리자 본인의 BYOK 행 상태를 함께 표시 —
    // 예전에 설정 화면(BYOK)으로 등록한 키가 admin 화면에서 "미설정"으로 보이는 혼선 방지.
    // fail-open — BYOK 조회 실패가 설정 화면 자체를 죽이지 않는다.
    const adminId = adminUserId(req);
    if (adminId) {
        for (const setting of settings) {
            const providerId = ADMIN_SYNCED_PROVIDER_KEYS[setting.key];
            if (!providerId) continue;
            try {
                const row = await getKeysRepo().getByUserAndProvider(adminId, providerId);
                if (row) {
                    setting.byokActive = true;
                    setting.byokKeyPrefix = row.keyPrefix;
                }
            } catch (err) {
                logger.warn(`BYOK 상태 조회 실패 (표시만 생략): ${setting.key}`, err);
            }
        }
    }
    res.json(success({ settings }));
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
    // 외부 provider 키는 관리자 본인 BYOK 행으로 연동 (fail-open)
    for (const [key, value] of Object.entries(validated)) {
        await syncAdminProviderKey(adminUserId(req), key, value);
    }
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
    await syncAdminProviderKey(adminUserId(req), key, null);
    await auditChange(req, 'system_settings.reset', { key });
    logger.info(`시스템 설정 삭제(env 폴백 복귀): ${key}`);
    res.json(success({ settings: getSystemSettingsService().describe() }));
}));
