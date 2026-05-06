/**
 * ============================================================
 * Conversation Audit Log — 메시지 본문 제외 운영 메타 기록
 * ============================================================
 *
 * `conversation_messages` 테이블이 사용자의 saveHistory 토글에 의해
 * 조건부 INSERT 되는 반면, 본 모듈은 **항상** 메타데이터를 기록한다.
 *
 * 기록 정책:
 *   - 사용자 ID, 세션 ID, 타임스탬프, 모델, 토큰, 응답시간, 에러 — 모두 항상
 *   - 본문(content) 자체는 절대 기록하지 않음 (privacy)
 *   - content_length 만 기록 (비정상 길이/abuse 감지)
 *   - content_skipped 플래그로 사용자가 본문 저장을 차단했음을 표시
 *
 * @module data/conversation-audit
 * @see services/database/migrations/014_conversation_audit_log.sql
 * @see chat/request-handler.ts (호출처)
 */

import { getPool } from './models/unified-database';
import { withRetry } from './retry-wrapper';
import { createLogger } from '../utils/logger';

const logger = createLogger('ConversationAudit');

/**
 * 감사 로그 INSERT 입력 파라미터
 */
export interface AuditLogEntry {
    sessionId: string;
    userId: string;
    messageRole: 'user' | 'assistant';
    /** 표시용 모델 (예: gemma4:e4b) */
    model?: string;
    /** 선택된 에이전트 ID (예: medical-doctor-001) */
    agentId?: string;
    promptTokens?: number;
    completionTokens?: number;
    responseTimeMs?: number;
    /** 에러 발생 시 식별 코드 (정상이면 undefined) */
    errorCode?: string;
    /** saveHistory=false 로 본문 저장이 스킵된 경우 true */
    contentSkipped: boolean;
    /** 본문 저장 여부와 무관하게 항상 길이 기록 */
    contentLength: number;
}

/**
 * 감사 로그 항목 1건 INSERT.
 *
 * 본문(content)은 절대 받지 않는다 — 호출자가 길이만 계산해 전달.
 *
 * 실패해도 throw 하지 않음 (감사 로그 실패가 채팅 흐름을 막으면 안 됨).
 * 단, 에러는 로그로 남겨 운영자가 확인 가능.
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
        const pool = getPool();
        await withRetry(
            () =>
                pool.query(
                    `INSERT INTO conversation_audit_log
                       (session_id, user_id, message_role, model, agent_id,
                        prompt_tokens, completion_tokens, response_time_ms,
                        error_code, content_skipped, content_length)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [
                        entry.sessionId,
                        entry.userId,
                        entry.messageRole,
                        entry.model ?? null,
                        entry.agentId ?? null,
                        entry.promptTokens ?? null,
                        entry.completionTokens ?? null,
                        entry.responseTimeMs ?? null,
                        entry.errorCode ?? null,
                        entry.contentSkipped,
                        entry.contentLength,
                    ],
                ),
            { operation: 'recordAuditLog' },
        );
    } catch (err) {
        // 감사 로그 실패는 사용자 채팅을 막지 않음 — 단, 운영자에게 경고
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
            `[Audit] 감사 로그 INSERT 실패 (session=${entry.sessionId}, role=${entry.messageRole}): ${msg}`,
        );
    }
}
