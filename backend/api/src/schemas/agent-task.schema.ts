/**
 * ============================================================
 * Agent Task Schema - 자율 에이전트 작업 Zod 검증 스키마
 * ============================================================
 *
 * @module schemas/agent-task.schema
 */
import { z } from 'zod';
import { secureTextSchema } from './security.schema';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';

/**
 * 에이전트 작업 생성 스키마
 * @property {string} goal - 작업 목표 (1~2000자, 필수)
 * @property {number} [maxTurns] - 최대 도구 루프 턴 수 (1~상한, 기본값: DEFAULT_MAX_TURNS)
 */
export const createAgentTaskSchema = z.object({
    goal: secureTextSchema({ minLength: 1, maxLength: 2000, fieldName: 'goal', detectMaliciousPatterns: false }),
    maxTurns: z.number().int().min(1).max(AGENT_TASK_LIMITS.MAX_TURNS_CEILING).optional(),
});

/** 에이전트 작업 생성 요청 TypeScript 타입 */
export type CreateAgentTaskInput = z.infer<typeof createAgentTaskSchema>;
