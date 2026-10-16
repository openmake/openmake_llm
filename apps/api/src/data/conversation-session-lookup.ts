/**
 * 대화 세션의 소유·요약 조회 — Base 데이터 포트(`runtime-ports/base-data-port.ts`)가 쓰는 읽기 전용 쿼리 (설계 3차 §3 C2, 작업 7).
 *
 * add-on 은 `conversation_sessions` 를 직접 읽지 않고 포트를 거친다. 여기 함수는 인가 판단을 하지 않는다 —
 * 소유 비교·actor 해석은 포트가 한다.
 *
 * @module data/conversation-session-lookup
 */
import { getPool } from './models/unified-database';

export interface SessionSummaryRow {
    id: string;
    title: string | null;
    updated_at: Date;
}

/** 이 사용자가 소유한 세션 id 전부 */
export async function listSessionIdsByOwner(userId: string): Promise<string[]> {
    const r = await getPool().query<{ id: string }>('SELECT id FROM conversation_sessions WHERE user_id = $1', [userId]);
    return r.rows.map((row) => row.id);
}

/** 세션 소유자 — 세션이 없으면 undefined, 익명 세션(user_id NULL)이면 null */
export async function getSessionOwnerId(sessionId: string): Promise<string | null | undefined> {
    const r = await getPool().query<{ user_id: string | null }>('SELECT user_id FROM conversation_sessions WHERE id = $1', [sessionId]);
    return r.rows[0] ? r.rows[0].user_id : undefined;
}

/** 주어진 세션들의 제목·갱신 시각(최근 갱신 순). 없는 id 는 빠진다 */
export async function getSessionSummaries(sessionIds: readonly string[]): Promise<SessionSummaryRow[]> {
    const r = await getPool().query<SessionSummaryRow>(
        'SELECT id, title, updated_at FROM conversation_sessions WHERE id = ANY($1::text[]) ORDER BY updated_at DESC',
        [sessionIds],
    );
    return r.rows;
}
