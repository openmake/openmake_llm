/**
 * ============================================================
 * Chat Feedback Schema - 채팅 피드백 Zod 검증 스키마
 * ============================================================
 *
 * 메시지 피드백 기록 요청의 유효성을 검증하는 Zod 스키마와
 * 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/chat-feedback.schema
 */
import { z } from 'zod';

/**
 * 채팅 피드백 기록 스키마
 * @property {string} messageId - 피드백 대상 메시지 ID (필수)
 * @property {string} sessionId - 세션 ID (필수)
 * @property {'thumbs_up'|'thumbs_down'|'regenerate'} signal - 피드백 신호 (필수)
 * @property {object} [routingMetadata] - 라우팅 메타데이터 (선택)
 */
export const chatFeedbackSchema = z.object({
    messageId: z.string().min(1, 'messageId는 필수입니다').max(255),
    sessionId: z.string().min(1, 'sessionId는 필수입니다').max(255),
    signal: z.enum(['thumbs_up', 'thumbs_down', 'regenerate'], {
        message: "signal은 'thumbs_up', 'thumbs_down', 'regenerate' 중 하나여야 합니다"
    }),
    routingMetadata: z.object({
        model: z.string().optional(),
        queryType: z.string().optional(),
        latencyMs: z.number().optional(),
        profileId: z.string().optional()
    }).optional()
});

/** 채팅 피드백 기록 요청 TypeScript 타입 */
export type ChatFeedbackInput = z.infer<typeof chatFeedbackSchema>;
