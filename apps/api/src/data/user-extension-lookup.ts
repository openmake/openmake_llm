/**
 * 사용자 확장의 이름 조회 — Base 데이터 포트(`runtime-ports/base-data-port.ts`)가 쓰는 읽기 전용 쿼리 (2026-10-18).
 *
 * add-on 은 `user_extensions` 를 직접 읽지 않고 포트를 거친다(스킬 draft 목록이 확장별로 묶기 위해 이름을 싣는다).
 * 인가 판단은 하지 않는다 — 호출부가 상위 자원(draft 목록)으로 인가한 id 만 넘긴다.
 *
 * @module data/user-extension-lookup
 */
import { getPool } from './models/unified-database';

/** 확장 id → 이름. 빈 입력은 조회 없이 빈 Map, 없는 id 는 빠진다 */
export async function getUserExtensionNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const r = await getPool().query<{ id: string; name: string }>(
        'SELECT id, name FROM user_extensions WHERE id = ANY($1::text[])',
        [[...ids]],
    );
    return new Map(r.rows.map((row) => [String(row.id), row.name]));
}
