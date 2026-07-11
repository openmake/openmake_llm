/**
 * ============================================================
 * Agent Task Schema - 자율 에이전트 작업 Zod 검증 스키마
 * ============================================================
 *
 * @module schemas/agent-task.schema
 */
import { z } from 'zod';
import { secureTextSchema } from './security.schema';
import { AGENT_TASK_LIMITS, FILE_ATTACH_LIMITS, DOC_EXTRACT_LIMITS } from '../config/runtime-limits';

/**
 * 작업 입력 첨부 파일 — 채팅 WS files[](WsAttachedFile) 와 동일 계약.
 * content 는 텍스트 내용, data 는 추출 대상 바이너리 문서(PDF/docx 등)의 base64 원본
 * (라우트가 doc-extractor 로 content 추출 후 폐기). 캡은 채팅 첨부와 동일 상수 재사용.
 */
const taskInputFileSchema = z.object({
    id: z.string().max(100).optional(),
    name: z.string().min(1).max(FILE_ATTACH_LIMITS.MAX_NAME_LENGTH),
    type: z.string().max(100).optional(),
    content: z.string().max(FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE).optional(),
    // base64 는 원본 바이트의 4/3 — 추출 상한 바이트 기준으로 환산 캡
    data: z.string().max(Math.ceil(DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE * 4 / 3) + 4).optional(),
    size: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
});

/**
 * 에이전트 작업 생성 스키마
 * @property {string} goal - 작업 목표 (1~2000자, 필수)
 * @property {number} [maxTurns] - 최대 도구 루프 턴 수 (1~상한, 기본값: DEFAULT_MAX_TURNS)
 * @property {Array} [files] - 입력 첨부 파일 (채팅 첨부와 동일 캡)
 * @property {Array} [images] - 입력 첨부 이미지 dataURL (vision 채널 전달)
 */
export const createAgentTaskSchema = z.object({
    goal: secureTextSchema({ minLength: 1, maxLength: 2000, fieldName: 'goal', detectMaliciousPatterns: false }),
    maxTurns: z.number().int().min(1).max(AGENT_TASK_LIMITS.MAX_TURNS_CEILING).optional(),
    files: z.array(taskInputFileSchema).max(FILE_ATTACH_LIMITS.MAX_FILES).optional(),
    images: z.array(
        z.string().startsWith('data:image/').max(FILE_ATTACH_LIMITS.MAX_IMAGE_DATAURL_CHARS)
    ).max(FILE_ATTACH_LIMITS.MAX_IMAGES).optional(),
});

/** 에이전트 작업 생성 요청 TypeScript 타입 */
export type CreateAgentTaskInput = z.infer<typeof createAgentTaskSchema>;

/**
 * 스케줄(반복 트리거) 생성 스키마 (Phase 3-A).
 * cron 또는 intervalSeconds 중 정확히 하나만 지정. interval 은 최소 간격 강제(남용 방지).
 * cron 표현식 유효성은 라우트에서 parseCron 으로 추가 검증.
 */
export const createAgentTaskScheduleSchema = z.object({
    goal: secureTextSchema({ minLength: 1, maxLength: 2000, fieldName: 'goal', detectMaliciousPatterns: false }),
    cron: z.string().min(1).max(120).optional(),
    intervalSeconds: z.number().int().min(AGENT_TASK_LIMITS.SCHEDULE_MIN_INTERVAL_SEC).max(365 * 24 * 3600).optional(),
    maxTurns: z.number().int().min(1).max(AGENT_TASK_LIMITS.MAX_TURNS_CEILING).optional(),
}).refine((v) => (!!v.cron) !== (v.intervalSeconds !== undefined), {
    message: 'cron 또는 intervalSeconds 중 정확히 하나를 지정하세요.',
});

/** 스케줄 부분 수정 스키마 — 제공된 필드만 갱신. */
export const updateAgentTaskScheduleSchema = z.object({
    goal: secureTextSchema({ minLength: 1, maxLength: 2000, fieldName: 'goal', detectMaliciousPatterns: false }).optional(),
    cron: z.string().min(1).max(120).nullable().optional(),
    intervalSeconds: z.number().int().min(AGENT_TASK_LIMITS.SCHEDULE_MIN_INTERVAL_SEC).max(365 * 24 * 3600).nullable().optional(),
    maxTurns: z.number().int().min(1).max(AGENT_TASK_LIMITS.MAX_TURNS_CEILING).optional(),
    enabled: z.boolean().optional(),
});

export type CreateAgentTaskScheduleInput = z.infer<typeof createAgentTaskScheduleSchema>;
export type UpdateAgentTaskScheduleInput = z.infer<typeof updateAgentTaskScheduleSchema>;

/** 템플릿 파라미터 정의(6-1) — {{name}} 자리 치환. */
const templateParamSchema = z.object({
    name: z.string().min(1).max(50).regex(/^[A-Za-z0-9_가-힣-]+$/, '파라미터 이름은 영숫자·한글·_·- 만 허용'),
    description: z.string().max(200).optional(),
    default: z.string().max(500).optional(),
});

/** 작업 템플릿 생성 스키마(6-1). goal_template 은 secureText(HTML 태그 금지 등) 적용. */
export const createAgentTaskTemplateSchema = z.object({
    name: z.string().min(1).max(100),
    goalTemplate: secureTextSchema({ minLength: 1, maxLength: 2000, fieldName: 'goalTemplate', detectMaliciousPatterns: false }),
    params: z.array(templateParamSchema).max(10).optional(),
    maxTurns: z.number().int().min(1).max(AGENT_TASK_LIMITS.MAX_TURNS_CEILING).optional(),
});

export const updateAgentTaskTemplateSchema = createAgentTaskTemplateSchema.partial();

/** 템플릿 instantiate 입력 — 파라미터 값 맵. */
export const instantiateTemplateSchema = z.object({
    values: z.record(z.string(), z.string().max(2000)).optional(),
    /** true(기본): 생성 즉시 실행(큐 경유). false: 생성만. */
    execute: z.boolean().optional(),
});

export type CreateAgentTaskTemplateInput = z.infer<typeof createAgentTaskTemplateSchema>;
export type UpdateAgentTaskTemplateInput = z.infer<typeof updateAgentTaskTemplateSchema>;
export type InstantiateTemplateInput = z.infer<typeof instantiateTemplateSchema>;
