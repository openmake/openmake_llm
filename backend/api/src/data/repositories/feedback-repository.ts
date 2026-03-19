/**
 * ============================================================
 * FeedbackRepository - 메시지 피드백 데이터 접근 레이어
 * ============================================================
 *
 * message_feedback 테이블에 대한 CRUD 및 집계 쿼리를 제공합니다.
 * thumbs_up / thumbs_down / regenerate 신호를 기록하고 통계를 반환합니다.
 *
 * @module data/repositories/feedback-repository
 */

import { Pool } from 'pg';

// ============================================================
// 타입 정의
// ============================================================

/** 피드백 신호 타입 */
export type FeedbackSignal = 'thumbs_up' | 'thumbs_down' | 'regenerate';

/** 피드백 기록 입력 데이터 */
export interface FeedbackRecord {
    /** 대상 메시지 ID */
    messageId: string;
    /** 대화 세션 ID */
    sessionId: string;
    /** 피드백을 남긴 사용자 ID (비로그인 시 undefined) */
    userId?: string;
    /** 피드백 신호 */
    signal: FeedbackSignal;
    /** 라우팅 메타데이터 (모델명, 쿼리 타입, 지연 시간 등) */
    routingMetadata?: {
        model?: string;
        queryType?: string;
        a2aMode?: string;
        latencyMs?: number;
        profileId?: string;
    };
}

/** 세션별 피드백 레코드 (DB 조회 결과) */
export interface FeedbackRow {
    id: number;
    message_id: string;
    session_id: string;
    user_id: string | null;
    signal: FeedbackSignal;
    routing_metadata: Record<string, unknown> | null;
    created_at: string;
}

/** 피드백 집계 통계 */
export interface FeedbackStats {
    /** 전체 피드백 수 */
    total: number;
    /** 좋아요 수 */
    thumbsUp: number;
    /** 싫어요 수 */
    thumbsDown: number;
    /** 재생성 요청 수 */
    regenerates: number;
    /** 모델별 좋아요/싫어요 분포 */
    byModel: Record<string, { up: number; down: number }>;
}

// ============================================================
// FeedbackRepository 클래스
// ============================================================

/**
 * message_feedback 테이블에 대한 데이터 접근 레이어
 */
export class FeedbackRepository {
    constructor(private readonly pool: Pool) {}

    /**
     * 피드백을 기록합니다.
     * @param record - 기록할 피드백 데이터
     */
    async recordFeedback(record: FeedbackRecord): Promise<void> {
        const { messageId, sessionId, userId, signal, routingMetadata } = record;
        const metadataJson = routingMetadata != null
            ? JSON.stringify(routingMetadata)
            : null;

        await this.pool.query(
            `INSERT INTO message_feedback
                (message_id, session_id, user_id, signal, routing_metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [messageId, sessionId, userId ?? null, signal, metadataJson]
        );
    }

    /**
     * 특정 세션의 피드백 목록을 반환합니다.
     * @param sessionId - 조회할 세션 ID
     * @param userId - (선택) 특정 사용자의 피드백만 필터링
     */
    async getFeedbackBySession(sessionId: string, userId?: string): Promise<FeedbackRow[]> {
        if (userId) {
            const result = await this.pool.query<FeedbackRow>(
                `SELECT id, message_id, session_id, user_id, signal, routing_metadata, created_at
                 FROM message_feedback
                 WHERE session_id = $1 AND user_id = $2
                 ORDER BY created_at ASC
                 LIMIT 500`,
                [sessionId, userId]
            );
            return result.rows;
        }

        const result = await this.pool.query<FeedbackRow>(
            `SELECT id, message_id, session_id, user_id, signal, routing_metadata, created_at
             FROM message_feedback
             WHERE session_id = $1
             ORDER BY created_at ASC
             LIMIT 500`,
            [sessionId]
        );
        return result.rows;
    }

    /**
     * 피드백 집계 통계를 반환합니다.
     * @param days - 집계 기간 (일, 기본값: 30)
     * @param userId - (선택) 특정 사용자의 피드백만 집계
     */
    async getFeedbackStats(days: number = 30, userId?: string): Promise<FeedbackStats> {
        const daysStr = String(days);

        // 전체 집계
        const totalResult = await this.pool.query<{
            total: string;
            thumbs_up: string;
            thumbs_down: string;
            regenerates: string;
        }>(
            `SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE signal = 'thumbs_up') AS thumbs_up,
                COUNT(*) FILTER (WHERE signal = 'thumbs_down') AS thumbs_down,
                COUNT(*) FILTER (WHERE signal = 'regenerate') AS regenerates
             FROM message_feedback
             WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
             ${userId ? 'AND user_id = $2' : ''}`,
            userId ? [daysStr, userId] : [daysStr]
        );

        const row = totalResult.rows[0] ?? { total: '0', thumbs_up: '0', thumbs_down: '0', regenerates: '0' };

        // 모델별 집계
        const modelResult = await this.pool.query<{
            model: string;
            up: string;
            down: string;
        }>(
            `SELECT
                routing_metadata->>'model' AS model,
                COUNT(*) FILTER (WHERE signal = 'thumbs_up') AS up,
                COUNT(*) FILTER (WHERE signal = 'thumbs_down') AS down
             FROM message_feedback
             WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
               AND routing_metadata->>'model' IS NOT NULL
             ${userId ? 'AND user_id = $2' : ''}
             GROUP BY routing_metadata->>'model'`,
            userId ? [daysStr, userId] : [daysStr]
        );

        const byModel: Record<string, { up: number; down: number }> = {};
        for (const modelRow of modelResult.rows) {
            byModel[modelRow.model] = {
                up: parseInt(modelRow.up, 10),
                down: parseInt(modelRow.down, 10),
            };
        }

        return {
            total: parseInt(row.total, 10),
            thumbsUp: parseInt(row.thumbs_up, 10),
            thumbsDown: parseInt(row.thumbs_down, 10),
            regenerates: parseInt(row.regenerates, 10),
            byModel,
        };
    }
}
