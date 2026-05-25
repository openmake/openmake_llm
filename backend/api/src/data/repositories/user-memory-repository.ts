/**
 * @module data/repositories/user-memory-repository
 * @description Cross-conversation memory (claude.ai / ChatGPT Memory 동등).
 *
 * 도입 (2026-05-26): mainstream gap closure Phase 3-A.
 * 사용자가 `/remember <사실>` slash command 로 저장한 항목을 다음 대화의
 * system prompt 에 prepend. auto-extraction 없음 (vLLM 부담 0).
 *
 * @see services/database/migrations/034_user_memories.sql
 */
import { BaseRepository, type QueryParam } from './base-repository';

export type MemorySource = 'explicit' | 'candidate' | 'batch';

export interface UserMemory {
    id: string;
    user_id: string;
    content: string;
    source: MemorySource;
    is_active: boolean;
    accessed_at: string | null;
    created_at: string;
    updated_at: string;
}

export class UserMemoryRepository extends BaseRepository {
    async create(id: string, userId: string, content: string, source: MemorySource = 'explicit'): Promise<UserMemory> {
        const result = await this.query<UserMemory>(
            `INSERT INTO user_memories (id, user_id, content, source) VALUES ($1, $2, $3, $4) RETURNING *`,
            [id, userId, content, source],
        );
        return result.rows[0] as UserMemory;
    }

    async listActiveByUser(userId: string, limit = 50): Promise<UserMemory[]> {
        const result = await this.query<UserMemory>(
            `SELECT * FROM user_memories
             WHERE user_id = $1 AND is_active = TRUE
             ORDER BY created_at DESC
             LIMIT $2`,
            [userId, limit],
        );
        return result.rows as UserMemory[];
    }

    async countActiveByUser(userId: string): Promise<number> {
        const result = await this.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM user_memories WHERE user_id = $1 AND is_active = TRUE`,
            [userId],
        );
        return parseInt(result.rows[0]?.count ?? '0', 10);
    }

    async softDeleteForUser(id: string, userId: string): Promise<boolean> {
        const result = await this.query(
            `UPDATE user_memories SET is_active = FALSE, updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
            [id, userId],
        );
        return result.rowCount! > 0;
    }

    async deleteAllForUser(userId: string): Promise<number> {
        const result = await this.query(
            `UPDATE user_memories SET is_active = FALSE, updated_at = NOW()
             WHERE user_id = $1 AND is_active = TRUE`,
            [userId],
        );
        return result.rowCount ?? 0;
    }

    async touchAccessed(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const params: QueryParam[] = ids;
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        await this.query(
            `UPDATE user_memories SET accessed_at = NOW() WHERE id IN (${placeholders})`,
            params,
        );
    }
}
