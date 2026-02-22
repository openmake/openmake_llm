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

/**
 * 커스텀 에이전트 생성 스키마
 * @property {string} name - 에이전트 이름 (1~100자, 필수)
 * @property {string} [description] - 에이전트 설명
 * @property {string} [systemPrompt] - 시스템 프롬프트
 * @property {string[]} [keywords] - 키워드 배열
 * @property {string} [category] - 카테고리
 * @property {string} [emoji] - 이모지 아이콘
 * @property {number} [temperature] - temperature 설정 (0~2)
 * @property {number} [maxTokens] - 최대 토큰 수
 */
export const createAgentSchema = z.object({
    name: z.string().min(1, '에이전트 이름을 입력하세요').max(100),
    description: z.string().max(500).optional(),
    systemPrompt: z.string().max(10000).optional(),
    keywords: z.array(z.string()).optional(),
    category: z.string().max(50).optional(),
    emoji: z.string().max(10).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().min(1).max(32000).optional()
});

/**
 * 커스텀 에이전트 수정 스키마 (모든 필드 optional)
 */
export const updateAgentSchema = z.object({
    name: z.string().min(1, '에이전트 이름을 입력하세요').max(100).optional(),
    description: z.string().max(500).optional(),
    systemPrompt: z.string().max(10000).optional(),
    keywords: z.array(z.string()).optional(),
    category: z.string().max(50).optional(),
    emoji: z.string().max(10).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().min(1).max(32000).optional()
});

/**
 * 에이전트 클론 수정 스키마
 */
export const cloneAgentSchema = z.object({
    modifications: updateAgentSchema.optional()
});

/** 커스텀 에이전트 생성 요청 TypeScript 타입 */
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
/** 커스텀 에이전트 수정 요청 TypeScript 타입 */
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
/** 에이전트 클론 수정 요청 TypeScript 타입 */
export type CloneAgentInput = z.infer<typeof cloneAgentSchema>;
