/**
 * ============================================================
 * Audit Schema - 감사 로그 Zod 검증 스키마
 * ============================================================
 *
 * 감사 로그 엔트리 생성 요청의 유효성을 검증하는
 * Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/audit.schema
 */
import { z } from 'zod';

/**
 * 감사 로그 생성 스키마
 * @property {string} action - 감사 액션 (필수, 1~100자)
 * @property {string} [resourceType] - 리소스 유형 (200자 이하)
 * @property {string} [resourceId] - 리소스 ID (500자 이하)
 * @property {object} [details] - 추가 세부정보
 */
export const createAuditSchema = z.object({
    action: z.string().min(1, 'action은 필수입니다').max(100),
    resourceType: z.string().max(200).optional(),
    resourceId: z.string().max(500).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
});

/** 감사 로그 생성 요청 TypeScript 타입 */
export type CreateAuditInput = z.infer<typeof createAuditSchema>;
