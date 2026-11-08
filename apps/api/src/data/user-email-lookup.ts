/**
 * 사용자 이메일 조회 — Base 데이터 포트(`runtime-ports/base-data-port.ts`)가 쓰는 읽기 전용 쿼리 (2026-11-08 점검 후속).
 *
 * add-on 은 `users` 를 직접 읽지 않고 포트를 거친다(관리자 MCP 서버 목록이 소유자 이메일을 싣는다).
 * 인가 판단은 하지 않는다 — 호출부(관리자 전용 라우트)가 이미 인가를 끝낸 경우에만 쓴다.
 *
 * @module data/user-email-lookup
 */
import { getPool } from './models/unified-database';

/** 사용자 id → 이메일. 빈 입력은 조회 없이 빈 Map, 없는 id·이메일이 없는 사용자는 빠진다 */
export async function getUserEmails(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const r = await getPool().query<{ id: string; email: string | null }>(
        'SELECT id, email FROM users WHERE id = ANY($1::text[])',
        [[...ids]],
    );
    return new Map(r.rows.filter((row) => row.email).map((row) => [String(row.id), row.email as string]));
}
