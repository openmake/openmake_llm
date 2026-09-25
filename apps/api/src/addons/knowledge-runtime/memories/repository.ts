/**
 * Space 메모리 리포지토리 — raw SQL. 인가(Space 읽기/쓰기)는 서비스가 먼저 확인하므로 여기선 space_id 로만 좁힌다.
 * 삭제는 tombstone(deleted_at). 주입·목록은 살아 있는 항목만 최신순.
 *
 * @module addons/knowledge-runtime/memories/repository
 */
import { randomUUID } from 'node:crypto';
import { kdb } from '../db';

export interface MemoryRow {
    id: string;
    content: string;
    created_at: string;
    updated_at: string;
}

/** Space 의 살아 있는 메모리 — 최신순(주입·목록 공용). */
export async function listMemoryRows(spaceId: string): Promise<MemoryRow[]> {
    const r = await kdb().query<MemoryRow>(
        `SELECT id, content, created_at, updated_at
         FROM knowledge_space_memories
         WHERE space_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [spaceId],
    );
    return r.rows;
}

/** 살아 있는 메모리 수 — maxMemoryItems 검사용. */
export async function countActiveMemories(spaceId: string): Promise<number> {
    const r = await kdb().query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM knowledge_space_memories WHERE space_id = $1 AND deleted_at IS NULL`,
        [spaceId],
    );
    return parseInt(r.rows[0]?.n ?? '0', 10);
}

export async function insertMemory(spaceId: string, content: string, createdBy: string): Promise<MemoryRow> {
    const id = randomUUID();
    const r = await kdb().query<MemoryRow>(
        `INSERT INTO knowledge_space_memories (id, space_id, content, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, content, created_at, updated_at`,
        [id, spaceId, content, createdBy],
    );
    return r.rows[0];
}

/** 내용 갱신 — 같은 Space 의 살아 있는 항목만. 없으면 null. */
export async function updateMemoryContent(spaceId: string, memId: string, content: string): Promise<MemoryRow | null> {
    const r = await kdb().query<MemoryRow>(
        `UPDATE knowledge_space_memories SET content = $3, updated_at = NOW()
         WHERE id = $2 AND space_id = $1 AND deleted_at IS NULL
         RETURNING id, content, created_at, updated_at`,
        [spaceId, memId, content],
    );
    return r.rows[0] ?? null;
}

/** tombstone — 같은 Space 의 살아 있는 항목만. 성공 시 true. */
export async function softDeleteMemory(spaceId: string, memId: string): Promise<boolean> {
    const r = await kdb().query(
        `UPDATE knowledge_space_memories SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND space_id = $1 AND deleted_at IS NULL`,
        [spaceId, memId],
    );
    return (r.rowCount ?? 0) > 0;
}
