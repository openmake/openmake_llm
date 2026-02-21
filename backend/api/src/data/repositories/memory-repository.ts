/**
 * @module data/repositories/memory-repository
 * @description `user_memories` / `memory_tags` 테이블 데이터 접근 계층
 *
 * 사용자별 장기 기억(UserMemory) 엔티티의 CRUD를 담당합니다.
 * - 메모리 생성 (UPSERT — 동일 key 존재 시 중요도 비교 후 갱신)
 * - 카테고리/태그 기반 검색, 관련 메모리 조회
 * - 접근 횟수 추적, 만료된 메모리 정리
 */
import { withTransaction } from '../retry-wrapper';
import { BaseRepository, QueryParam } from './base-repository';
import type { MemoryCategory, UserMemory } from '../models/unified-database';

export class MemoryRepository extends BaseRepository {
    async createMemory(params: {
        id: string;
        userId: string;
        category: MemoryCategory;
        key: string;
        value: string;
        importance?: number;
        sourceSessionId?: string;
        tags?: string[];
    }): Promise<void> {
        await withTransaction(this.pool, async (client) => {
            await client.query(
                `INSERT INTO user_memories (id, user_id, category, key, value, importance, source_session_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT(user_id, category, key) DO UPDATE SET
                    value = EXCLUDED.value,
                    importance = CASE WHEN EXCLUDED.importance > user_memories.importance THEN EXCLUDED.importance ELSE user_memories.importance END,
                    updated_at = NOW(),
                    access_count = user_memories.access_count + 1`,
                [
                    params.id,
                    params.userId,
                    params.category,
                    params.key,
                    params.value,
                    params.importance || 0.5,
                    params.sourceSessionId
                ]
            );

            if (params.tags && params.tags.length > 0) {
                const tagValues = params.tags.map((_, i) => `($1, $${i + 2})`).join(', ');
                await client.query(
                    `INSERT INTO memory_tags (memory_id, tag) VALUES ${tagValues} ON CONFLICT DO NOTHING`,
                    [params.id, ...params.tags]
                );
            }
        });
    }

    async getUserMemories(userId: string, options?: {
        category?: MemoryCategory;
        limit?: number;
        minImportance?: number;
    }): Promise<UserMemory[]> {
        let query = 'SELECT * FROM user_memories WHERE user_id = $1';
        const params: QueryParam[] = [userId];
        let paramIdx = 2;

        if (options?.category) {
            query += ` AND category = $${paramIdx++}`;
            params.push(options.category);
        }
        if (options?.minImportance) {
            query += ` AND importance >= $${paramIdx++}`;
            params.push(options.minImportance);
        }

        query += ' ORDER BY importance DESC, updated_at DESC';

        if (options?.limit) {
            query += ` LIMIT $${paramIdx++}`;
            params.push(options.limit);
        }

        const result = await this.query<UserMemory>(query, params);
        return result.rows as UserMemory[];
    }

    async getRelevantMemories(userId: string, query: string, limit: number = 10): Promise<UserMemory[]> {
        const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

        if (keywords.length === 0) {
            return this.getUserMemories(userId, { limit });
        }

        const params: QueryParam[] = [userId];
        let paramIdx = 2;
        const conditions = keywords.map(kw => {
            const p1 = paramIdx++;
            const p2 = paramIdx++;
            params.push(`%${kw}%`, `%${kw}%`);
            return `(LOWER(key) LIKE $${p1} OR LOWER(value) LIKE $${p2})`;
        }).join(' OR ');

        params.push(limit);
        const limitParam = paramIdx++;

        const sqlQuery = `
            SELECT * FROM user_memories 
            WHERE user_id = $1 AND (${conditions})
            ORDER BY importance DESC, updated_at DESC
            LIMIT $${limitParam}
        `;

        const result = await this.query<UserMemory>(sqlQuery, params);
        const rows = result.rows as UserMemory[];

        if (rows.length > 0) {
            const ids = rows.map(m => m.id);
            const idPlaceholders = ids.map((_, i) => `$${i + 1}`).join(',');
            await this.query(
                `UPDATE user_memories 
                SET access_count = access_count + 1, last_accessed = NOW() 
                WHERE id IN (${idPlaceholders})`,
                ids
            );
        }

        return rows;
    }

    async updateMemory(memoryId: string, updates: { value?: string; importance?: number }): Promise<void> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.value !== undefined) {
            sets.push(`value = $${paramIdx++}`);
            params.push(updates.value);
        }
        if (updates.importance !== undefined) {
            sets.push(`importance = $${paramIdx++}`);
            params.push(updates.importance);
        }

        params.push(memoryId);
        await this.query(`UPDATE user_memories SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
    }

    async deleteMemory(memoryId: string): Promise<void> {
        await this.query('DELETE FROM user_memories WHERE id = $1', [memoryId]);
    }

    async deleteUserMemories(userId: string): Promise<void> {
        await this.query('DELETE FROM user_memories WHERE user_id = $1', [userId]);
    }
}
