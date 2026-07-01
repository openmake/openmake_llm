/**
 * ============================================================
 * Artifact Session Access — 세션 접근 검증 헬퍼
 * ============================================================
 *
 * artifacts.routes 에서 추출 (파일 크기 가드). 인증 사용자(user_id) 또는
 * 게스트(anon_session_id) 의 conversation_sessions 접근 권한을 검증한다.
 *
 * @module routes/artifact-session-access
 */

import { Request, Response } from 'express';
import { getPool } from '../data/models/unified-database';
import { notFound, unauthorized, forbidden } from '../utils/api-response';

/** 요청에서 userId 추출 (JWT userId 또는 id). 미인증이면 undefined. */
export function resolveUserId(req: Request): string | undefined {
    if (!req.user) return undefined;
    return 'userId' in req.user ? (req.user as { userId: string }).userId : req.user.id?.toString();
}

export function resolveAnonSessionId(req: Request): string | undefined {
    const raw = req.query.anonSessionId ?? req.body?.anonSessionId ?? req.get('x-anon-session-id');
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

export async function assertSessionAccess(req: Request, sessionId: string): Promise<void> {
    if (req.user?.role === 'admin') return;

    const pool = getPool();
    const result = await pool.query<{ user_id: string | null; anon_session_id: string | null }>(
        'SELECT user_id, anon_session_id FROM conversation_sessions WHERE id = $1',
        [sessionId]
    );
    const session = result.rows[0];
    if (!session) {
        throw Object.assign(new Error('SESSION_NOT_FOUND'), { statusCode: 404 });
    }

    const userId = resolveUserId(req);
    if (userId && session.user_id === userId) return;

    const anonSessionId = resolveAnonSessionId(req);
    if (anonSessionId && session.anon_session_id === anonSessionId) return;

    throw Object.assign(new Error(userId || anonSessionId ? 'SESSION_FORBIDDEN' : 'SESSION_UNAUTHORIZED'), {
        statusCode: userId || anonSessionId ? 403 : 401,
    });
}

export function sendSessionAccessError(res: Response, error: unknown): boolean {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0;
    if (statusCode === 404) {
        res.status(404).json(notFound('session'));
        return true;
    }
    if (statusCode === 401) {
        res.status(401).json(unauthorized('인증이 필요합니다'));
        return true;
    }
    if (statusCode === 403) {
        res.status(403).json(forbidden('권한이 없습니다'));
        return true;
    }
    return false;
}
