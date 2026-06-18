/**
 * ============================================================
 * Export Controller — GDPR Phase B Fix 6 (B6)
 * ============================================================
 *
 * GDPR Article 20 (right to data portability) — 사용자가 본인의 모든 데이터를
 * 단일 JSON 으로 export.
 *
 * 5개 카테고리 병렬 조회:
 *   1. conversation_sessions + 그 안의 messages
 *   2. skill_manifests (created_by 본인)
 *   3. agent_skills (legacy, created_by 본인)
 *   4. custom_agents (created_by 본인)
 *   5. user_memories (user_id 본인)
 *
 * Rate limit: RL_GDPR_EXPORT (시간당 사용자별 N회).
 *
 * @module controllers/export
 */
import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../auth/middleware';
import { getPool } from '../data/models/unified-database';
import { RL_GDPR_EXPORT } from '../config/rate-limits';
import { createLogger } from '../utils/logger';
import { internalError, badRequest } from '../utils/api-response';
import type { QueryResultRow } from 'pg';

const log = createLogger('ExportController');

type ExportRole = 'user' | 'admin';

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

function resolveExportRole(req: Request): ExportRole {
    if (!req.user) return 'user';
    const role = ('role' in req.user ? (req.user as { role?: string }).role : undefined);
    return role === 'admin' ? 'admin' : 'user';
}

function exportKeyGen(req: Request): string {
    const uid = getUserId(req);
    return uid ? `export:user:${uid}` : `export:ip:${ipKeyGenerator(req.ip || 'unknown')}`;
}

const exportLimiter = rateLimit({
    windowMs: RL_GDPR_EXPORT.windowMs,
    limit: (req: Request): number => RL_GDPR_EXPORT.limits[resolveExportRole(req)],
    keyGenerator: exportKeyGen,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response): void => {
        res.status(429).json({
            success: false,
            error: { code: 'RATE_LIMITED', message: '데이터 export 시간당 한도를 초과했습니다. 잠시 후 다시 시도하세요.' },
        });
    },
});

/**
 * 5개 카테고리 병렬 조회. 각 query 실패는 개별 catch 로 빈 배열 반환 (export 자체는
 * 계속 — 사용자가 부분 데이터라도 받을 수 있게).
 */
async function collectUserData(userId: string): Promise<Record<string, unknown>> {
    const pool = getPool();

    const safeQuery = async <T extends QueryResultRow>(label: string, sql: string, params: unknown[]): Promise<T[]> => {
        try {
            const r = await pool.query<T>(sql, params);
            return r.rows;
        } catch (err) {
            log.warn(`[Export] ${label} 조회 실패 (continue):`, err);
            return [];
        }
    };

    const [user, sessions, manifests, agentSkills, customAgents, memories] = await Promise.all([
        safeQuery<Record<string, unknown>>('user', `SELECT id, username, email, role, created_at FROM users WHERE id = $1`, [userId]),
        safeQuery<Record<string, unknown>>('conversation_sessions',
            `SELECT s.id, s.title, s.created_at, s.updated_at,
                COALESCE(
                    (SELECT json_agg(m ORDER BY m.created_at)
                     FROM conversation_messages m WHERE m.session_id = s.id),
                    '[]'::json
                ) AS messages
             FROM conversation_sessions s WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 500`,
            [userId]),
        safeQuery<Record<string, unknown>>('skill_manifests',
            `SELECT id, version, manifest_yaml, prompt_md, checksum, is_public, created_by, created_at, updated_at
             FROM skill_manifests WHERE created_by = $1 ORDER BY created_at DESC`,
            [userId]),
        safeQuery<Record<string, unknown>>('agent_skills',
            `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at
             FROM agent_skills WHERE created_by = $1 ORDER BY created_at DESC`,
            [userId]),
        safeQuery<Record<string, unknown>>('custom_agents',
            `SELECT id, name, description, system_prompt, model, temperature, max_tokens, created_by, status, created_at, updated_at
             FROM custom_agents WHERE created_by = $1 ORDER BY created_at DESC`,
            [userId]),
        safeQuery<Record<string, unknown>>('user_memories',
            `SELECT id, user_id, category, key, value, importance, created_at, updated_at
             FROM user_memories WHERE user_id = $1 ORDER BY created_at DESC`,
            [userId]),
    ]);

    return {
        timestamp: new Date().toISOString(),
        version: '1.0',
        user: user[0] || null,
        conversationSessions: sessions,
        skillManifests: manifests,
        agentSkills,
        customAgents,
        userMemories: memories,
        _meta: {
            counts: {
                conversationSessions: sessions.length,
                skillManifests: manifests.length,
                agentSkills: agentSkills.length,
                customAgents: customAgents.length,
                userMemories: memories.length,
            },
            note: 'GDPR Article 20 right to data portability. consent_logs, api_keys (암호화) 는 보안상 미포함.',
        },
    };
}

export function createExportController(): Router {
    const router = Router();

    /**
     * GET /api/users/me/export — 사용자 전체 데이터 JSON export.
     */
    router.get('/', requireAuth, exportLimiter, async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = getUserId(req);
            if (!userId) {
                res.status(400).json(badRequest('user id 추출 실패'));
                return;
            }
            const data = await collectUserData(userId);
            log.info(`[Export] user=${userId} sessions=${(data._meta as { counts: { conversationSessions: number } }).counts.conversationSessions}`);
            // GDPR Article 20 — export.requested audit (warning, AlertSystem 자동)
            void (async () => {
                try {
                    const { getAuditService } = await import('../services/AuditService');
                    await getAuditService().logAudit({
                        action: 'export.requested',
                        userId,
                        resourceType: 'user_data_export',
                        resourceId: userId,
                        details: (data._meta as { counts?: unknown })?.counts as Record<string, unknown> | undefined,
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'],
                        actor: {
                            email: req.user && 'email' in req.user ? (req.user as { email?: string }).email : undefined,
                            role: req.user && 'role' in req.user ? (req.user as { role?: string }).role : undefined,
                        },
                    });
                } catch (e) { log.warn('[audit] export.requested 기록 실패:', e); }
            })();

            // Content-Disposition 으로 즉시 download. JSON response 가 아닌 attachment 로 처리.
            const date = new Date().toISOString().slice(0, 10);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="openmake_full_export_${date}.json"`);
            res.send(JSON.stringify(data, null, 2));
        } catch (err) {
            log.error('[Export] error:', err);
            res.status(500).json(internalError('데이터 export 실패'));
        }
    });

    return router;
}
