/**
 * 대화 폴더 CRUD (F19.5, 157) — 사용자 소유. 폴더 삭제 시 세션 folder_id 는 FK 로 NULL.
 *
 * @module data/conversation-folders
 */
import { randomUUID } from 'crypto';
import { getPool } from './models/unified-database';
import { CONVERSATION_LIMITS } from '../config/runtime-limits';

export interface ConversationFolder {
    id: string;
    name: string;
    position: number;
    sessionCount: number;
    createdAt: string;
    updatedAt: string;
}

interface FolderRow { id: string; name: string; position: number; session_count: string | number; created_at: string; updated_at: string }

function toFolder(r: FolderRow): ConversationFolder {
    return { id: r.id, name: r.name, position: r.position, sessionCount: Number(r.session_count ?? 0), createdAt: r.created_at, updatedAt: r.updated_at };
}

export class FolderLimitError extends Error {}
export class FolderNameConflictError extends Error {}

export async function listFolders(userId: string): Promise<ConversationFolder[]> {
    const r = await getPool().query<FolderRow>(
        `SELECT f.*, (SELECT count(*) FROM conversation_sessions s WHERE s.folder_id = f.id) AS session_count
         FROM conversation_folders f WHERE f.user_id = $1 ORDER BY f.position ASC, f.created_at ASC`,
        [userId],
    );
    return r.rows.map(toFolder);
}

export async function createFolder(userId: string, name: string): Promise<ConversationFolder> {
    const pool = getPool();
    const count = await pool.query<{ n: string }>('SELECT count(*) AS n FROM conversation_folders WHERE user_id = $1', [userId]);
    if (Number(count.rows[0]?.n ?? 0) >= CONVERSATION_LIMITS.MAX_FOLDERS_PER_USER) {
        throw new FolderLimitError(`폴더는 최대 ${CONVERSATION_LIMITS.MAX_FOLDERS_PER_USER}개까지 만들 수 있습니다`);
    }
    try {
        const r = await pool.query<FolderRow>(
            `INSERT INTO conversation_folders (id, user_id, name, position)
             VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position) + 1, 0) FROM conversation_folders WHERE user_id = $2))
             RETURNING *, 0 AS session_count`,
            [randomUUID(), userId, name],
        );
        return toFolder(r.rows[0]);
    } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new FolderNameConflictError('같은 이름의 폴더가 있습니다');
        throw e;
    }
}

/** 소유자 폴더만 수정 — 없거나 남의 폴더면 null */
export async function updateFolder(userId: string, id: string, patch: { name?: string; position?: number }): Promise<ConversationFolder | null> {
    try {
        const r = await getPool().query<FolderRow>(
            `UPDATE conversation_folders SET name = COALESCE($3, name), position = COALESCE($4, position), updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING *, (SELECT count(*) FROM conversation_sessions s WHERE s.folder_id = conversation_folders.id) AS session_count`,
            [id, userId, patch.name ?? null, patch.position ?? null],
        );
        return r.rows[0] ? toFolder(r.rows[0]) : null;
    } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new FolderNameConflictError('같은 이름의 폴더가 있습니다');
        throw e;
    }
}

export async function deleteFolder(userId: string, id: string): Promise<boolean> {
    const r = await getPool().query('DELETE FROM conversation_folders WHERE id = $1 AND user_id = $2', [id, userId]);
    return (r.rowCount ?? 0) > 0;
}

export async function isFolderOwnedBy(userId: string, id: string): Promise<boolean> {
    const r = await getPool().query('SELECT 1 FROM conversation_folders WHERE id = $1 AND user_id = $2', [id, userId]);
    return (r.rowCount ?? 0) > 0;
}
