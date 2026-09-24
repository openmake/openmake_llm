/**
 * ============================================================
 * Agents Schema - 커스텀 에이전트 Zod 검증 스키마
 * ============================================================
 *
 * 커스텀 에이전트 생성, 수정 요청의 유효성을 검증하는
 * Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/agents.schema
 */
import { z } from 'zod';
import { SCHEMA_LIMITS } from '../config/http-data-limits';

const { agents: AG } = SCHEMA_LIMITS;

/**
 * 에이전트 피드백 제출 스키마
 * @property {number} rating - 평점 (1~5, 필수)
 * @property {string} query - 원본 질문 (필수, 5000자 이하)
 * @property {string} response - 에이전트 응답 (필수, 10000자 이하)
 * @property {string} [comment] - 피드백 코멘트
 * @property {string[]} [tags] - 피드백 태그
 */
export const agentFeedbackSchema = z.object({
    rating: z.number().int().min(AG.RATING_MIN, 'rating은 1 이상이어야 합니다').max(AG.RATING_MAX, 'rating은 5 이하여야 합니다'),
    query: z.string().min(1, 'query는 필수입니다').max(AG.QUERY_MAX),
    response: z.string().min(1, 'response는 필수입니다').max(AG.RESPONSE_MAX),
    comment: z.string().max(AG.COMMENT_MAX).optional(),
    tags: z.array(z.string().max(AG.TAG_MAX)).max(AG.TAGS_COUNT_MAX).optional(),
});

/**
 * A/B 테스트 시작 스키마
 * @property {string} agentA - 에이전트 A ID (필수)
 * @property {string} agentB - 에이전트 B ID (필수)
 */
export const abTestStartSchema = z.object({
    agentA: z.string().min(1, 'agentA는 필수입니다'),
    agentB: z.string().min(1, 'agentB는 필수입니다'),
});

/**
 * 에이전트/사용자 스킬 할당 스키마
 * @property {number} [priority] - 스킬 우선순위 (0~100, 기본값 0)
 */
export const assignSkillSchema = z.object({
    priority: z.number().int().min(AG.PRIORITY_MIN).max(AG.PRIORITY_MAX).optional(),
});

