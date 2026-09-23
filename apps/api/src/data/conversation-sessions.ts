/**
 * ============================================================
 * Conversation Sessions - 세션 CRUD 및 관리
 * ============================================================
 *
 * 대화 세션의 생성, 조회, 수정, 삭제, 익명 이관, 정리를 담당합니다.
 *
 * @module data/conversation-sessions
 */

import { v4 as uuidv4 } from 'uuid';
import { getPool } from './models/unified-database';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';
import { isPersistableUserId } from '../utils/user-id-validation';
import { withRetry, withTransaction } from './retry-wrapper';
import {
    ConversationSession,
    SessionRow,
    SessionMeta,
    MessageRow,
    rowToMessage,
    rowToSession
} from './conversation-types';
import { loadMessagesForSessions } from './conversation-messages';
import { CONVERSATION_LIMITS, SESSION_BRANCH } from '../config/runtime-limits';
import { SQL_RESULT_LIMITS } from '../config/http-data-limits';

const logger = createLogger('ConversationSessions');

// 설정: 환경변수로 조정 가능
const MAX_SESSIONS = getConfig().maxConversationSessions;

/**
 * 세션 수 제한 적용 (소유자별 MAX_SESSIONS 초과 시 그 소유자의 가장 오래된 세션 삭제).
 *
 * 캡은 반드시 소유자(user_id 또는 anon_session_id)로 스코프한다. 전역으로 적용하면
 * 한 사용자/게스트가 총량을 밀어올려 다른 사용자의 오래된 세션(+CASCADE 메시지)을
 * 축출할 수 있다. 소유자 미상 세션은 캡을 적용하지 않는다.
 */
async function enforceMaxSessions(userId?: string, anonSessionId?: string): Promise<void> {
    // ownerClause 의 컬럼명은 하드코딩(파라미터화 값만 바인딩) — 인젝션 없음
    let ownerClause: string;
    let ownerParam: string;
    if (userId) {
        ownerClause = 'user_id = $1';
        ownerParam = userId;
    } else if (anonSessionId) {
        ownerClause = 'anon_session_id = $1';
        ownerParam = anonSessionId;
    } else {
        return;
    }

    const pool = getPool();
    const countResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM conversation_sessions WHERE ${ownerClause}`,
        [ownerParam]
    );
    const cnt = parseInt(countResult.rows[0].cnt, 10);
    if (cnt <= MAX_SESSIONS) return;

    const excess = cnt - MAX_SESSIONS;
    await pool.query(`
        DELETE FROM conversation_sessions WHERE id IN (
            SELECT id FROM conversation_sessions WHERE ${ownerClause} ORDER BY updated_at ASC LIMIT $2
        )
    `, [ownerParam, excess]);

    logger.info(`[ConversationSessions] Cleaned ${excess} sessions (owner-scoped, limit: ${MAX_SESSIONS})`);
}

/**
 * 새 세션 생성
 */
export async function createSession(
    userId?: string,
    title?: string,
    metadata?: Record<string, unknown> | null,
    anonSessionId?: string
): Promise<ConversationSession> {
    const pool = getPool();
    const id = uuidv4();
    const now = new Date().toISOString();
    const resolvedTitle = title || '새 대화';

    await withRetry(() => pool.query(`
        INSERT INTO conversation_sessions (id, user_id, anon_session_id, title, created_at, updated_at, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
        id,
        userId || null,
        anonSessionId || null,
        resolvedTitle,
        now,
        now,
        metadata ? JSON.stringify(metadata) : null
    ]), { operation: 'createSession' });

    await enforceMaxSessions(userId, anonSessionId);

    return {
        id,
        userId: userId || undefined,
        anonSessionId: anonSessionId || undefined,
        title: resolvedTitle,
        created_at: now,
        updated_at: now,
        metadata,
        messages: []
    };
}

/**
 * 세션 단건 조회 (메시지 포함)
 */
export async function getSession(id: string): Promise<ConversationSession | undefined> {
    const pool = getPool();
    const sessionResult = await pool.query('SELECT * FROM conversation_sessions WHERE id = $1', [id]);
    const row = sessionResult.rows[0] as SessionRow | undefined;
    if (!row) return undefined;

    const msgResult = await pool.query(
        'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
        [id, CONVERSATION_LIMITS.SESSION_DETAIL_MESSAGES]
    );

    const messages = (msgResult.rows as MessageRow[]).map(mr => rowToMessage(mr));
    return rowToSession(row, messages);
}

/**
 * 세션 메타 단건 조회 (메시지 미포함).
 *
 * 소유권 검증이나 metadata 만 필요한 경로용. getSession() 은 메시지까지 추가로
 * 조회하므로 그 목적에는 과하다. 라우트가 직접 SQL 을 실행하던 두 곳
 * (artifact-session-access.assertSessionAccess, GET /api/sessions/:sid/meta)이
 * 이 함수를 공유한다.
 */
export async function getSessionMeta(id: string): Promise<SessionMeta | undefined> {
    const pool = getPool();
    const result = await pool.query<Pick<SessionRow, 'user_id' | 'anon_session_id' | 'title' | 'metadata'>>(
        'SELECT user_id, anon_session_id, title, metadata, version FROM conversation_sessions WHERE id = $1',
        [id]
    );
    const row = result.rows[0] as (typeof result.rows[0] & { version?: number }) | undefined;
    if (!row) return undefined;
    return {
        userId: row.user_id,
        anonSessionId: row.anon_session_id,
        title: row.title,
        metadata: row.metadata,
        version: typeof row.version === 'number' ? row.version : undefined,
    };
}

/** 제목 갱신(낙관적 잠금, 140) — expectedVersion 이 현재와 같을 때만. 반환 ok=false 면 현재 버전. */
export async function updateSessionTitleIfVersion(sessionId: string, title: string, expectedVersion: number): Promise<{ ok: boolean; version: number }> {
    const pool = getPool();
    const r = await pool.query<{ version: number }>(
        'UPDATE conversation_sessions SET title = $1, updated_at = NOW(), version = version + 1 WHERE id = $2 AND version = $3 RETURNING version',
        [title, sessionId, expectedVersion],
    );
    if (r.rows[0]) return { ok: true, version: r.rows[0].version };
    const cur = await pool.query<{ version: number }>('SELECT version FROM conversation_sessions WHERE id = $1', [sessionId]);
    return { ok: false, version: cur.rows[0]?.version ?? 0 };
}

/** 폴더·태그 목록 필터(157) — folderId 'none' 은 미분류. 컬럼명은 고정, 값만 바인딩 */
export interface SessionListFilter { folderId?: string; tag?: string }

/** PURE: 필터 → 추가 WHERE 절과 파라미터(시작 번호부터) */
export function sessionFilterClause(filter: SessionListFilter | undefined, startIndex: number): { sql: string; params: string[] } {
    const parts: string[] = [];
    const params: string[] = [];
    if (filter?.folderId === 'none') parts.push('cs.folder_id IS NULL');
    else if (filter?.folderId) { params.push(filter.folderId); parts.push(`cs.folder_id = $${startIndex + params.length - 1}`); }
    if (filter?.tag) { params.push(filter.tag); parts.push(`$${startIndex + params.length - 1} = ANY(cs.tags)`); }
    return { sql: parts.map((p) => ` AND ${p}`).join(''), params };
}

/**
 * 사용자 ID로 세션 목록 조회
 */
export async function getSessionsByUserId(userId: string, limit: number = CONVERSATION_LIMITS.SESSION_LIST_DEFAULT, filter?: SessionListFilter): Promise<ConversationSession[]> {
    const pool = getPool();
    const f = sessionFilterClause(filter, 3);
    // 메시지 0개 세션 제외 — saveHistory:false 요청은 세션 행만 만들고 본문을 저장하지 않아
    // (멀티턴 continuation 위해 세션 자체는 유지) 최근 목록에 빈 껍데기로 뜨던 것을 차단.
    const result = await pool.query(
        `SELECT * FROM conversation_sessions cs
         WHERE cs.user_id = $1
           AND EXISTS (SELECT 1 FROM conversation_messages m WHERE m.session_id = cs.id)${f.sql}
         ORDER BY cs.updated_at DESC LIMIT $2`,
        [userId, limit, ...f.params]
    );

    // list view: 세션당 최근 50개만 — 5K+ 메시지 사용자의 메모리 spike 방지.
    // single-session detail 은 getSession() 의 LIMIT 500 으로 별도 로드.
    return loadMessagesForSessions(result.rows as SessionRow[], { maxMessagesPerSession: CONVERSATION_LIMITS.LIST_MESSAGES_PER_SESSION });
}

/**
 * 익명 세션 ID로 세션 목록 조회
 */
export async function getSessionsByAnonId(anonSessionId: string, limit: number = CONVERSATION_LIMITS.SESSION_LIST_DEFAULT): Promise<ConversationSession[]> {
    const pool = getPool();
    const result = await pool.query(
        `SELECT * FROM conversation_sessions cs
         WHERE cs.anon_session_id = $1
           AND EXISTS (SELECT 1 FROM conversation_messages m WHERE m.session_id = cs.id)
         ORDER BY cs.updated_at DESC LIMIT $2`,
        [anonSessionId, limit]
    );

    // list view: 세션당 최근 50개만 — 5K+ 메시지 사용자의 메모리 spike 방지.
    // single-session detail 은 getSession() 의 LIMIT 500 으로 별도 로드.
    return loadMessagesForSessions(result.rows as SessionRow[], { maxMessagesPerSession: CONVERSATION_LIMITS.LIST_MESSAGES_PER_SESSION });
}

/**
 * 세션 검색 (제목 + 메시지 본문) — history 검색이 제목만 필터하던 갭 해소.
 *
 * 소유자(userId 또는 anonSessionId) 스코프에서 제목 ILIKE 또는 메시지 content ILIKE
 * 매칭 세션을 반환하고, 본문 매칭 세션에는 최신 매칭 메시지의 발췌(snippet)를 함께 담는다.
 * (ILIKE 순차 스캔 — 현 규모(월 수천 메시지)에선 충분. 대규모화 시 pg_trgm 인덱스 후보.)
 */
export async function searchSessionsByOwner(
    owner: { userId?: string; anonSessionId?: string },
    query: string,
    limit: number = CONVERSATION_LIMITS.SESSION_LIST_DEFAULT,
    filter?: SessionListFilter,
): Promise<{ sessions: ConversationSession[]; snippets: Record<string, string> }> {
    const ownerVal = owner.userId ?? owner.anonSessionId;
    if (!ownerVal || !query.trim()) return { sessions: [], snippets: {} };
    // ownerClause 의 컬럼명은 하드코딩(파라미터화 값만 바인딩) — enforceMaxSessions 동일 관용구
    const ownerClause = owner.userId ? 'cs.user_id = $1' : 'cs.anon_session_id = $1';
    // ILIKE 메타문자(\ % _) 이스케이프 — 검색어가 패턴으로 해석되는 것을 차단
    const pattern = '%' + query.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    // 폴더·태그 필터는 로그인 사용자만(익명 세션에는 폴더·태그가 없다)
    const f = sessionFilterClause(owner.userId ? filter : undefined, 4);

    const pool = getPool();
    const result = await pool.query(
        `SELECT cs.*, hit.snippet FROM conversation_sessions cs
         LEFT JOIN LATERAL (
             SELECT m.content AS snippet FROM conversation_messages m
             WHERE m.session_id = cs.id AND m.content ILIKE $2
             ORDER BY m.created_at DESC LIMIT 1
         ) hit ON true
         WHERE ${ownerClause}
           AND (cs.title ILIKE $2 OR hit.snippet IS NOT NULL)
           AND EXISTS (SELECT 1 FROM conversation_messages m WHERE m.session_id = cs.id)${f.sql}
         ORDER BY cs.updated_at DESC LIMIT $3`,
        [ownerVal, pattern, limit, ...f.params]
    );

    const rows = result.rows as (SessionRow & { snippet: string | null })[];
    const snippets: Record<string, string> = {};
    for (const row of rows) {
        if (typeof row.snippet === 'string' && row.snippet.length > 0) {
            snippets[row.id] = excerptAround(row.snippet, query.trim());
        }
    }
    const sessions = await loadMessagesForSessions(rows, { maxMessagesPerSession: CONVERSATION_LIMITS.LIST_MESSAGES_PER_SESSION });
    return { sessions, snippets };
}

/** 매칭 지점 주변 발췌 — 목록에서 "왜 검색됐는지" 문맥을 보여준다. */
function excerptAround(content: string, query: string, radius: number = CONVERSATION_LIMITS.SEARCH_SNIPPET_RADIUS): string {
    const idx = content.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return content.slice(0, radius * 2);
    const start = Math.max(0, idx - radius);
    const end = Math.min(content.length, idx + query.length + radius);
    return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

/**
 * 전체 세션 목록 조회 (관리자 전용 화면 — offset 페이지네이션 지원)
 */
export async function getAllSessions(
    limit: number = CONVERSATION_LIMITS.SESSION_LIST_ALL_DEFAULT,
    offset: number = 0,
): Promise<ConversationSession[]> {
    const pool = getPool();
    const result = await pool.query(
        `SELECT * FROM conversation_sessions cs
         WHERE EXISTS (SELECT 1 FROM conversation_messages m WHERE m.session_id = cs.id)
         ORDER BY cs.updated_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
    );

    // list view: 세션당 최근 50개만 — 5K+ 메시지 사용자의 메모리 spike 방지.
    // single-session detail 은 getSession() 의 LIMIT 500 으로 별도 로드.
    return loadMessagesForSessions(result.rows as SessionRow[], { maxMessagesPerSession: CONVERSATION_LIMITS.LIST_MESSAGES_PER_SESSION });
}

/**
 * 전체 세션 총 건수 — getAllSessions 와 동일 필터(메시지 있는 세션만).
 * 관리자 화면 페이지네이션의 전체 페이지 수 계산에 사용.
 */
export async function countAllSessions(): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM conversation_sessions cs
         WHERE EXISTS (SELECT 1 FROM conversation_messages m WHERE m.session_id = cs.id)`
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * 하위 호환성: guest이면 전체, 그 외는 사용자별 조회
 */
export async function getSessions(userId: string, limit: number = CONVERSATION_LIMITS.SESSION_LIST_DEFAULT): Promise<ConversationSession[]> {
    if (!isPersistableUserId(userId)) {
        return getAllSessions(limit);
    }
    return getSessionsByUserId(userId, limit);
}

/**
 * getUserSessions 별칭 (하위 호환)
 */
export async function getUserSessions(userId: string): Promise<ConversationSession[]> {
    return getSessions(userId);
}

/**
 * 세션 제목 업데이트
 */
export async function updateSessionTitle(sessionId: string, title: string): Promise<boolean> {
    const pool = getPool();
    const now = new Date().toISOString();
    const result = await pool.query(
        'UPDATE conversation_sessions SET title = $1, updated_at = $2, version = version + 1 WHERE id = $3',
        [title, now, sessionId]
    );

    return (result.rowCount || 0) > 0;
}

/**
 * 세션 폴더·태그 변경(157) — 주어진 필드만. 폴더 소유권 검증은 호출부(컨트롤러)가 한다.
 */
export async function updateSessionOrganization(sessionId: string, patch: { folderId?: string | null; tags?: string[] }): Promise<{ folderId: string | null; tags: string[] } | null> {
    const sets: string[] = [];
    const params: unknown[] = [sessionId];
    if (patch.folderId !== undefined) { params.push(patch.folderId); sets.push(`folder_id = $${params.length}`); }
    if (patch.tags !== undefined) { params.push(patch.tags); sets.push(`tags = $${params.length}::text[]`); }
    if (!sets.length) return null;
    const r = await getPool().query<{ folder_id: string | null; tags: string[] }>(
        `UPDATE conversation_sessions SET ${sets.join(', ')} WHERE id = $1 RETURNING folder_id, tags`,
        params,
    );
    return r.rows[0] ? { folderId: r.rows[0].folder_id, tags: r.rows[0].tags ?? [] } : null;
}

/**
 * 세션 삭제 (CASCADE로 메시지 함께 삭제)
 */
export async function deleteSession(id: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM conversation_sessions WHERE id = $1', [id]);
    return (result.rowCount || 0) > 0;
}

/**
 * 특정 사용자의 모든 대화 세션을 삭제합니다.
 * CASCADE로 메시지도 함께 삭제됩니다.
 * @param userId - 사용자 ID
 * @returns 삭제된 세션 수
 */
export async function deleteAllSessionsByUserId(userId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
        'DELETE FROM conversation_sessions WHERE user_id = $1',
        [userId]
    );
    const count = result.rowCount || 0;
    if (count > 0) {
        logger.info(`[ConversationSessions] Deleted all ${count} sessions for user ${userId}`);
    }
    return count;
}

/**
 * 익명 세션을 로그인한 사용자에게 이관
 * anon_session_id로 생성된 세션의 user_id를 업데이트하고 anon_session_id를 제거
 * @returns 이관된 세션 수
 */
export async function claimAnonymousSessions(userId: string, anonSessionId: string): Promise<number> {
    const pool = getPool();
    const now = new Date().toISOString();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const sessions = await client.query<{ id: string }>(
            `SELECT id
               FROM conversation_sessions
              WHERE anon_session_id = $1
                AND (user_id IS NULL OR user_id = $2)`,
            [anonSessionId, userId]
        );
        const sessionIds = sessions.rows.map((r) => r.id);

        if (sessionIds.length > 0) {
            await client.query(
                `UPDATE artifacts
                    SET user_id = $1
                  WHERE session_id = ANY($2::text[])
                    AND user_id IS NULL`,
                [userId, sessionIds]
            );
            await client.query(
                `UPDATE conversation_sessions
                    SET user_id = $1, anon_session_id = NULL, updated_at = $2
                  WHERE id = ANY($3::text[])`,
                [userId, now, sessionIds]
            );
        }

        await client.query('COMMIT');
        const count = sessionIds.length;
        if (count > 0) {
            logger.info(`[ConversationSessions] Claimed ${count} anonymous sessions for user ${userId}`);
        }
        return count;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * 오래된 세션 정리
 * @param days - 기준 일수 (이보다 오래된 세션 삭제)
 * @returns 삭제된 세션 수
 */
export async function cleanupOldSessions(days: number): Promise<number> {
    const pool = getPool();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
        'DELETE FROM conversation_sessions WHERE updated_at < $1',
        [cutoff]
    );

    const count = result.rowCount || 0;
    if (count > 0) {
        logger.info(`[ConversationSessions] Cleaned ${count} old sessions (${days} days)`);
    }
    return count;
}

/** PURE: 복제 세션 metadata (140·F08 PR-6). WS branchFrom* 의 parentSessionId/parentMessageId/forkedAt 규격과 같고 kind 만 다르다. */
export function buildCloneMetadata(parentSessionId: string, parentMessageId: string | null, now: Date = new Date()): Record<string, unknown> {
    return { parentSessionId, ...(parentMessageId ? { parentMessageId } : {}), forkedAt: now.toISOString(), kind: 'clone' };
}

/**
 * 세션 복제(F08 PR-6) — 부모 메시지(선택: uptoMessageId 까지)를 새 세션으로 복사한다. 단일 트랜잭션.
 * client_message_id 는 복사하지 않는다(140 유니크는 세션 단위라 충돌은 없지만 멱등 키는 원 요청에만 의미가 있다).
 */
export async function cloneSession(
    srcId: string,
    opts: { uptoMessageId?: number | null; title?: string | null; userId?: string; anonSessionId?: string },
): Promise<{ id: string; copied: number; title: string } | null> {
    const pool = getPool();
    const src = await pool.query<{ title: string }>('SELECT title FROM conversation_sessions WHERE id = $1', [srcId]);
    if (!src.rows[0]) return null;
    const id = uuidv4();
    const title = (opts.title && opts.title.trim()) || `${src.rows[0].title} (분기)`;
    const now = new Date();
    const copied = await withRetry(() => withTransaction(pool, async (client) => {
        await client.query(
            `INSERT INTO conversation_sessions (id, user_id, anon_session_id, title, created_at, updated_at, metadata)
             VALUES ($1, $2, $3, $4, $5, $5, $6)`,
            [id, opts.userId || null, opts.anonSessionId || null, title, now.toISOString(), JSON.stringify(buildCloneMetadata(srcId, opts.uptoMessageId ? String(opts.uptoMessageId) : null, now))],
        );
        const r = await client.query(
            `INSERT INTO conversation_messages (session_id, role, content, model, agent_id, thinking, tokens, response_time_ms, created_at, reasoning_summary)
             SELECT $1, role, content, model, agent_id, thinking, tokens, response_time_ms, created_at, reasoning_summary
             FROM (SELECT * FROM conversation_messages WHERE session_id = $2 AND ($3::int IS NULL OR id <= $3::int) ORDER BY created_at ASC, id ASC LIMIT $4) m`,
            [id, srcId, opts.uptoMessageId ?? null, SESSION_BRANCH.CLONE_MAX_MESSAGES],
        );
        return r.rowCount ?? 0;
    }), { operation: 'cloneSession' });
    return { id, copied, title };
}

/** 세션 트리(F08 PR-6) — 조상 체인(가까운 순, 최대 TREE_MAX_DEPTH)과 직계 자식. metadata.parentSessionId 표현식 인덱스(140) 사용. */
export async function getSessionTree(id: string): Promise<{ ancestors: Array<{ id: string; title: string; parentMessageId: string | null }>; children: Array<{ id: string; title: string; createdAt: string }> }> {
    const pool = getPool();
    const anc = await pool.query<{ id: string; title: string; parent_message_id: string | null }>(
        `WITH RECURSIVE up AS (
             SELECT s.id, s.title, s.metadata, 0 AS depth FROM conversation_sessions s WHERE s.id = $1
             UNION ALL
             SELECT p.id, p.title, p.metadata, up.depth + 1 FROM up JOIN conversation_sessions p ON p.id = up.metadata->>'parentSessionId'
             WHERE up.depth < $2
         )
         SELECT id, title, metadata->>'parentMessageId' AS parent_message_id FROM up WHERE depth > 0 ORDER BY depth ASC`,
        [id, SESSION_BRANCH.TREE_MAX_DEPTH],
    );
    const kids = await pool.query<{ id: string; title: string; created_at: string }>(
        `SELECT id, title, created_at FROM conversation_sessions WHERE metadata->>'parentSessionId' = $1 ORDER BY created_at DESC LIMIT $2`,
        [id, SQL_RESULT_LIMITS.SESSION_TREE_CHILDREN]);
    return {
        ancestors: anc.rows.map((r) => ({ id: r.id, title: r.title, parentMessageId: r.parent_message_id })),
        children: kids.rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at })),
    };
}
