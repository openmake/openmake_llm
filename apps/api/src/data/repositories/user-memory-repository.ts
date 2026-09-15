/**
 * @module data/repositories/user-memory-repository
 * @description Cross-conversation memory (claude.ai / ChatGPT Memory 동등).
 *
 * 도입 (2026-05-26): mainstream gap closure Phase 3-A.
 * 사용자가 REST `POST /api/users/me/memories` 로 저장한 항목을 다음 대화의
 * system prompt 에 주입(정적 헌법 뒤 DYNAMIC BOUNDARY — prefix cache 보존).
 * 자동 형성은 2026-07-22 추가(memory-extraction.ts, env 게이트 기본 OFF) + CLI 백필.
 * ⚠️ 채팅 입력 `/remember` 슬래시 명령은 미구현(slash-command.ts 는 스킬 매칭 전용) —
 * 입력 경로는 설정 탭(REST POST /api/users/me/memories)·자동 추출·백필 셋뿐.
 *
 * source 의미(034 스키마 정의와 일치시킬 것):
 *   explicit  — 사용자 명시(설정 탭 입력, "기억해줘" 류 휴리스틱 패턴)
 *   candidate — 모델 감지(메시지당 LLM 추출)
 *   batch     — 일괄 추출(CLI 백필)
 *
 * 삭제는 soft(is_active=false)이며 삭제 행은 tombstone 으로 남는다 — 자동 추출·백필의
 * 중복 판정은 listKnownContentsByUser(비활성 포함)를 쓴다(삭제한 문장이 되살아나지 않게).
 *
 * @see db/migrations/034_user_memories.sql
 */
import { BaseRepository, type QueryParam } from './base-repository';
import { MEMORY_CONFIDENCE_BY_SOURCE, isSensitiveMemory, type MemoryScope, type MemorySensitivity } from '../../config/memory-metadata';

type MemorySource = 'explicit' | 'candidate' | 'batch';

interface UserMemory {
    id: string;
    user_id: string;
    content: string;
    source: MemorySource;
    is_active: boolean;
    accessed_at: string | null;
    created_at: string;
    updated_at: string;
    /** 범위 메타데이터(126) — 구 행은 기본값(user · 출처별 신뢰도 · normal · 무기한). */
    scope: MemoryScope;
    confidence: number | null;
    sensitivity: MemorySensitivity;
    expires_at: string | null;
}

/** create 의 선택 메타 — 미지정은 규칙(config/memory-metadata)으로 채운다. */
export interface MemoryCreateMeta {
    scope?: MemoryScope;
    confidence?: number;
    sensitivity?: MemorySensitivity;
    expiresAt?: Date | null;
}

export class UserMemoryRepository extends BaseRepository {
    async create(id: string, userId: string, content: string, source: MemorySource = 'explicit', meta: MemoryCreateMeta = {}): Promise<UserMemory> {
        const result = await this.query<UserMemory>(
            `INSERT INTO user_memories (id, user_id, content, source, scope, confidence, sensitivity, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                id, userId, content, source,
                meta.scope ?? 'user',
                meta.confidence ?? MEMORY_CONFIDENCE_BY_SOURCE[source],
                meta.sensitivity ?? (isSensitiveMemory(content) ? 'sensitive' : 'normal'),
                meta.expiresAt ? meta.expiresAt.toISOString() : null,
            ],
        );
        return result.rows[0] as UserMemory;
    }

    /** 활성 + 미만료(126) — 주입·목록 공용. 만료 행은 tombstone 처럼 남되 보이지 않는다. */
    async listActiveByUser(userId: string, limit = 50): Promise<UserMemory[]> {
        const result = await this.query<UserMemory>(
            `SELECT * FROM user_memories
             WHERE user_id = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY created_at DESC
             LIMIT $2`,
            [userId, limit],
        );
        return result.rows as UserMemory[];
    }

    /**
     * 중복 판정용 — 비활성(삭제) 행 포함 전체 content. 삭제한 문장을 자동 추출이 다시 만들지
     * 않도록 tombstone 역할(2026-09-06). 최근 순 상한(limit).
     */
    async listKnownContentsByUser(userId: string, limit = 500): Promise<string[]> {
        const result = await this.query<{ content: string }>(
            `SELECT content FROM user_memories
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [userId, limit],
        );
        return result.rows.map((r) => r.content);
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

    async touchAccessed(userId: string, ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const params: QueryParam[] = [userId, ...ids];
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
        await this.query(
            `UPDATE user_memories SET accessed_at = NOW() WHERE user_id = $1 AND id IN (${placeholders})`,
            params,
        );
    }
}
