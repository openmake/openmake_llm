/**
 * @module data/repositories/conversation-repository
 * @description `conversation_sessions` / `conversation_messages` 테이블 데이터 접근 계층
 *
 * 대화 세션과 메시지 엔티티의 CRUD를 담당합니다.
 * - 세션 생성/조회/삭제, 사용자별 세션 목록
 * - 메시지 추가/조회, 세션별 메시지 히스토리
 * - 세션 제목/메타데이터 갱신
 */
import type { QueryResult } from 'pg';
import { BaseRepository } from './base-repository';
import type { ConversationMessage, ConversationSession } from '../models/unified-database.types';

export class ConversationRepository extends BaseRepository {
    async createSession(id: string, userId?: string, title?: string, metadata?: Record<string, unknown> | null): Promise<QueryResult<Record<string, unknown>>> {
        return this.query(
            'INSERT INTO conversation_sessions (id, user_id, title, metadata) VALUES ($1, $2, $3, $4)',
            [id, userId, title || '새 대화', JSON.stringify(metadata || {})]
        );
    }

    async addMessage(sessionId: string, role: string, content: string, options?: {
        model?: string;
        agentId?: string;
        thinking?: string;
        tokens?: number;
        responseTimeMs?: number;
    }): Promise<QueryResult<Record<string, unknown>>> {
        return this.query(
            `INSERT INTO conversation_messages 
            (session_id, role, content, model, agent_id, thinking, tokens, response_time_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                sessionId,
                role,
                content,
                options?.model,
                options?.agentId,
                options?.thinking,
                options?.tokens,
                options?.responseTimeMs
            ]
        );
    }

    async getSessionMessages(sessionId: string, limit: number = 100): Promise<ConversationMessage[]> {
        const result = await this.query<ConversationMessage>(
            'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
            [sessionId, limit]
        );
        return result.rows as ConversationMessage[];
    }

    async getUserSessions(userId: string, limit: number = 50): Promise<ConversationSession[]> {
        const result = await this.query<ConversationSession>(
            'SELECT * FROM conversation_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [userId, limit]
        );
        return result.rows as ConversationSession[];
    }

    async getAllSessions(limit: number = 50): Promise<ConversationSession[]> {
        const result = await this.query<ConversationSession>(
            'SELECT * FROM conversation_sessions ORDER BY updated_at DESC LIMIT $1',
            [limit]
        );
        return result.rows as ConversationSession[];
    }

    async deleteSession(sessionId: string): Promise<{ changes: number }> {
        const result = await this.query('DELETE FROM conversation_sessions WHERE id = $1', [sessionId]);
        return { changes: result.rowCount || 0 };
    }

    // ── 분석 집계 ─────────────────────────────────────────────────────
    // 라우트(metrics/usage)가 직접 실행하던 집계 SQL 을 옮겨온 것. 여기로 오면
    // BaseRepository.query 의 withRetry 가 적용돼 다른 DB 접근과 동일하게 동작한다.
    // 숫자 파싱(COUNT/SUM 은 문자열로 옴)은 응답 조립부에 남겨 둔다.

    /** 전체 일별 대화량 (메시지 수 + 고유 세션 수) — 관리자 대시보드 */
    async getDailyConversationCounts(days: number): Promise<Array<{ date: string; messages: string; sessions: string }>> {
        const result = await this.query<{ date: string; messages: string; sessions: string }>(
            `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
                    COUNT(*) AS messages,
                    COUNT(DISTINCT session_id) AS sessions
             FROM conversation_messages
             WHERE created_at >= NOW() - ($1 || ' days')::interval
             GROUP BY 1
             ORDER BY 1`,
            [String(days)]
        );
        return result.rows;
    }

    /** 모델별 assistant 응답 수 (전체) — 관리자 대시보드 */
    async getModelUsageCounts(days: number): Promise<Array<{ model: string; count: string }>> {
        const result = await this.query<{ model: string; count: string }>(
            `SELECT COALESCE(model, '(unknown)') AS model,
                    COUNT(*) AS count
             FROM conversation_messages
             WHERE created_at >= NOW() - ($1 || ' days')::interval
               AND role = 'assistant'
             GROUP BY 1
             ORDER BY count DESC`,
            [String(days)]
        );
        return result.rows;
    }

    /** 본인 모델별 토큰 합계 + 요청 수(assistant 메시지 수) */
    async getUserModelUsage(userId: string): Promise<Array<{ model: string; tokens: string; requests: string }>> {
        const result = await this.query<{ model: string; tokens: string; requests: string }>(
            `SELECT COALESCE(m.model, 'default') AS model,
                    COALESCE(SUM(m.tokens), 0) AS tokens,
                    COUNT(*) FILTER (WHERE m.role = 'assistant') AS requests
             FROM conversation_messages m
             JOIN conversation_sessions s ON m.session_id = s.id
             WHERE s.user_id = $1
             GROUP BY 1`,
            [userId]
        );
        return result.rows;
    }

    /**
     * 본인 토큰 사용량 기간 버킷 집계 — 가상 비용 환산(usage /cost)용.
     *
     * 소스는 대화(conversation_messages.tokens) + 에이전트 작업(agent_tasks.total_tokens) 합산 —
     * 실측상 작업 토큰이 지배적(18.8M vs 0.3M)이라 대화만 집계하면 비용이 크게 과소평가된다.
     * granularity: 'day'(최근 30일) | 'month'(최근 12개월) | 'year'(전체).
     */
    async getUserTokenBuckets(
        userId: string,
        granularity: 'day' | 'month' | 'year',
    ): Promise<Array<{ period: string; tokens: string }>> {
        // 컬럼/포맷은 granularity 별 하드코딩 상수 선택(값 바인딩만 파라미터) — 인젝션 없음
        const spec = {
            day: { trunc: 'day', fmt: 'YYYY-MM-DD', since: `NOW() - interval '30 days'` },
            month: { trunc: 'month', fmt: 'YYYY-MM', since: `NOW() - interval '12 months'` },
            year: { trunc: 'year', fmt: 'YYYY', since: `'epoch'::timestamptz` },
        }[granularity];
        const result = await this.query<{ period: string; tokens: string }>(
            `WITH tok AS (
                 SELECT m.created_at AS ts, m.tokens AS tokens
                 FROM conversation_messages m
                 JOIN conversation_sessions s ON m.session_id = s.id
                 WHERE s.user_id = $1 AND m.tokens > 0
                 UNION ALL
                 SELECT t.created_at AS ts, t.total_tokens AS tokens
                 FROM agent_tasks t
                 WHERE t.user_id = $1 AND t.total_tokens > 0
             )
             SELECT to_char(date_trunc('${spec.trunc}', ts), '${spec.fmt}') AS period,
                    COALESCE(SUM(tokens), 0) AS tokens
             FROM tok
             WHERE ts >= ${spec.since}
             GROUP BY 1
             ORDER BY 1`,
            [userId]
        );
        return result.rows;
    }

    /** 본인 일별 토큰/메시지 통계 */
    async getUserDailyUsage(userId: string, days: number): Promise<Array<{ date: string; tokens: string; messages: string }>> {
        const result = await this.query<{ date: string; tokens: string; messages: string }>(
            `SELECT to_char(date_trunc('day', m.created_at), 'YYYY-MM-DD') AS date,
                    COALESCE(SUM(m.tokens), 0) AS tokens,
                    COUNT(*) AS messages
             FROM conversation_messages m
             JOIN conversation_sessions s ON m.session_id = s.id
             WHERE s.user_id = $1
               AND m.created_at >= NOW() - ($2 || ' days')::interval
             GROUP BY 1
             ORDER BY 1`,
            [userId, String(days)]
        );
        return result.rows;
    }
}
