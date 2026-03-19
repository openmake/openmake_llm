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

        const limit = options?.limit ?? 100;
        query += ` LIMIT $${paramIdx++}`;
        params.push(limit);

        const result = await this.query<UserMemory>(query, params);
        return result.rows as UserMemory[];
    }

    /** 검색에서 제외할 불용어 */
    private static readonly STOPWORDS = new Set([
        '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '로', '로서',
        'the', 'is', 'at', 'in', 'on', 'an', 'and', 'or', 'to', 'of', 'for', 'it',
    ]);

    async getRelevantMemories(userId: string, query: string, limit: number = 10): Promise<UserMemory[]> {
        const keywords = query.toLowerCase().split(/\s+/).filter(
            w => w.length > 1 && !MemoryRepository.STOPWORDS.has(w)
        );

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

        // access_count 갱신은 검색 응답을 블로킹하지 않도록 비동기 fire-and-forget
        if (rows.length > 0) {
            const ids = rows.map(m => m.id);
            const idPlaceholders = ids.map((_, i) => `$${i + 1}`).join(',');
            this.query(
                `UPDATE user_memories
                SET access_count = access_count + 1, last_accessed = NOW()
                WHERE id IN (${idPlaceholders})`,
                ids
            ).catch(() => { /* access_count 갱신 실패는 무시 — 핵심 검색 기능에 영향 없음 */ });
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

    async getOwnerUserId(memoryId: string): Promise<string | null> {
        const result = await this.query<{ user_id: string }>(
            'SELECT user_id FROM user_memories WHERE id = $1',
            [memoryId]
        );

        return result.rows[0]?.user_id ?? null;
    }

    async deleteMemory(memoryId: string): Promise<void> {
        await this.query('DELETE FROM user_memories WHERE id = $1', [memoryId]);
    }

    async deleteUserMemories(userId: string): Promise<void> {
        await this.query('DELETE FROM user_memories WHERE user_id = $1', [userId]);
    }

    /**
     * 만료된 메모리 정리 (expires_at이 현재 시각보다 이전인 레코드 삭제)
     * @returns 삭제된 행 수
     */
    async cleanupExpiredMemories(): Promise<number> {
        const result = await this.query(
            'DELETE FROM user_memories WHERE expires_at IS NOT NULL AND expires_at < NOW()'
        );
        return result.rowCount ?? 0;
    }

    /**
     * 중요도 시간 감쇠: 30일 이상 미접근 메모리의 importance를 5% 감쇠
     * importance가 0.1 이하로 내려가지 않도록 제한
     * @returns 갱신된 행 수
     */
    async decayImportance(): Promise<number> {
        const result = await this.query(
            `UPDATE user_memories
             SET importance = GREATEST(0.1, importance * 0.95),
                 updated_at = NOW()
             WHERE last_accessed < NOW() - INTERVAL '30 days'
               AND importance > 0.1`
        );
        return result.rowCount ?? 0;
    }
}
