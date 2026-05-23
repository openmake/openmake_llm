/**
 * ============================================================
 * Consent Controller — GDPR Phase B Fix 6 (B7) + Phase A Fix 4 follow-up
 * ============================================================
 *
 * 동의 관리 API. Phase A 의 회원가입 동의 (consent_logs INSERT) 후
 * 사용자가 본인 동의 상태를 조회 / 철회할 수 있는 인터페이스.
 *
 * Endpoints:
 *   GET  /api/users/me/consent          — 현재 동의 상태 (privacy + terms)
 *   POST /api/users/me/consent/withdraw — 동의 철회 (granted=false 새 row INSERT)
 *
 * (PR-7 에서 추가 예정: GET /api/users/me/consent/status — 재동의 필요 여부)
 *
 * Article 7(3) right to withdraw consent — 동의 철회가 동의 부여만큼 쉬워야 함.
 *
 * @module controllers/consent
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';
import { success, internalError, badRequest } from '../utils/api-response';

const log = createLogger('ConsentController');

const VALID_CONSENT_TYPES = ['privacy_policy', 'terms_of_service'] as const;
type ConsentType = typeof VALID_CONSENT_TYPES[number];

const withdrawSchema = z.object({
    type: z.enum(VALID_CONSENT_TYPES),
});

const grantSchema = z.object({
    type: z.enum(VALID_CONSENT_TYPES),
    version: z.string().min(1).max(20),
    locale: z.string().min(2).max(10).optional().default('ko'),
});

/**
 * Phase A 의 CURRENT_POLICY_VERSION 과 동기 — Phase A AuthService.ts:22
 * Single source of truth 로 별도 export 모듈 분리는 후속 (현재 const 동기 유지).
 */
const CURRENT_POLICY_VERSION = '1.0';

interface ConsentStatus {
    type: ConsentType;
    version: string | null;
    locale: string | null;
    granted: boolean;
    granted_at: string | null;
}

/**
 * req.user 에서 user id 추출 — controller 단계에서 requireAuth 통과 이후 호출.
 */
function getUserId(req: Request): string | null {
    if (!req.user) return null;
    if ('userId' in req.user && typeof (req.user as { userId?: unknown }).userId === 'string') {
        return (req.user as { userId: string }).userId;
    }
    if ('id' in req.user) {
        return String(req.user.id);
    }
    return null;
}

/**
 * 각 type 의 latest row 반환. 사용자가 한 번도 해당 type 에 대해 동의/철회한
 * 적이 없으면 `granted=false` 의 placeholder 반환 (안전 default).
 */
async function getCurrentConsents(userId: string): Promise<ConsentStatus[]> {
    const pool = getPool();
    const result = await pool.query<{
        consent_type: ConsentType;
        consent_version: string;
        consent_locale: string;
        granted: boolean;
        granted_at: Date;
    }>(
        `SELECT DISTINCT ON (consent_type)
            consent_type, consent_version, consent_locale, granted, granted_at
         FROM consent_logs
         WHERE user_id = $1
         ORDER BY consent_type, granted_at DESC`,
        [userId],
    );
    const latest = new Map<ConsentType, ConsentStatus>();
    for (const row of result.rows) {
        latest.set(row.consent_type, {
            type: row.consent_type,
            version: row.consent_version,
            locale: row.consent_locale,
            granted: row.granted,
            granted_at: row.granted_at.toISOString(),
        });
    }
    return VALID_CONSENT_TYPES.map(type => latest.get(type) ?? {
        type,
        version: null,
        locale: null,
        granted: false,
        granted_at: null,
    });
}

export function createConsentController(): Router {
    const router = Router();

    /**
     * GET /api/users/me/consent — 현재 동의 상태 조회
     */
    router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = getUserId(req);
            if (!userId) {
                res.status(400).json(badRequest('user id 추출 실패'));
                return;
            }
            const consents = await getCurrentConsents(userId);
            res.json(success({ consents }));
        } catch (err) {
            log.error('[Consent GET] error:', err);
            res.status(500).json(internalError('동의 상태 조회 실패'));
        }
    });

    /**
     * POST /api/users/me/consent/withdraw — 동의 철회 (granted=false 새 row INSERT).
     * 기존 동의 row 는 보존 (이력 추적). 최신 row 의 granted 가 현재 상태.
     */
    router.post('/withdraw', requireAuth, validate(withdrawSchema), async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = getUserId(req);
            if (!userId) {
                res.status(400).json(badRequest('user id 추출 실패'));
                return;
            }
            const { type } = req.body as { type: ConsentType };

            // 사용자의 latest version/locale 가져오기 — 철회 row 의 version/locale 도 보존
            const latest = (await getCurrentConsents(userId)).find(c => c.type === type);
            const version = latest?.version || 'unknown';
            const locale = latest?.locale || 'unknown';

            const pool = getPool();
            await pool.query(
                `INSERT INTO consent_logs (user_id, consent_type, consent_version, consent_locale, granted, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4, FALSE, $5, $6)`,
                [userId, type, version, locale, req.ip || null, req.headers['user-agent'] || null],
            );
            log.info(`[Consent withdraw] user=${userId} type=${type}`);
            res.json(success({ withdrawn: true, type }));
        } catch (err) {
            log.error('[Consent withdraw] error:', err);
            res.status(500).json(internalError('동의 철회 실패'));
        }
    });

    /**
     * GET /api/users/me/consent/status — 재동의 필요 여부 (Phase B Fix 7).
     * 사용자의 latest granted=true row 의 version 과 CURRENT_POLICY_VERSION 비교.
     * 사용자가 한 번도 동의 안 했거나 (Phase A 이전 가입), 버전 불일치, 또는 철회
     * 상태면 needsConsent=true + 해당 type 들 반환.
     */
    router.get('/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = getUserId(req);
            if (!userId) {
                res.status(400).json(badRequest('user id 추출 실패'));
                return;
            }
            const consents = await getCurrentConsents(userId);
            const pendingTypes: ConsentType[] = consents
                .filter(c => !c.granted || c.version !== CURRENT_POLICY_VERSION)
                .map(c => c.type);
            res.json(success({
                needsConsent: pendingTypes.length > 0,
                currentVersion: CURRENT_POLICY_VERSION,
                pendingTypes,
                consents,  // 현재 상태도 함께 반환 (UI 가 details 표시)
            }));
        } catch (err) {
            log.error('[Consent status] error:', err);
            res.status(500).json(internalError('동의 상태 확인 실패'));
        }
    });

    /**
     * POST /api/users/me/consent — 재동의 (granted=true 새 row INSERT).
     * 재동의 prompt 에서 호출. PR-3 의 회원가입 INSERT 와 동일 형식.
     */
    router.post('/', requireAuth, validate(grantSchema), async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = getUserId(req);
            if (!userId) {
                res.status(400).json(badRequest('user id 추출 실패'));
                return;
            }
            const { type, version, locale } = req.body as { type: ConsentType; version: string; locale: string };

            const pool = getPool();
            await pool.query(
                `INSERT INTO consent_logs (user_id, consent_type, consent_version, consent_locale, granted, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4, TRUE, $5, $6)`,
                [userId, type, version, locale, req.ip || null, req.headers['user-agent'] || null],
            );
            log.info(`[Consent grant] user=${userId} type=${type} version=${version}`);
            res.json(success({ granted: true, type, version }));
        } catch (err) {
            log.error('[Consent grant] error:', err);
            res.status(500).json(internalError('동의 기록 실패'));
        }
    });

    return router;
}
