/**
 * ============================================================
 * Structured Answer Schema — JSON Schema 구조화 출력 계약
 * ============================================================
 *
 * 제안서(2026-06-26) 3·4절: LLM 이 자유 마크다운을 즉흥 작성하는 대신, 답변의
 * "뼈대"(제목·결론·요약·섹션·표·리스크·실행항목)를 JSON 으로 받는다. 이 모듈은
 * 그 계약 한 곳(SoT)이다.
 *
 *   - `AnswerIntent`            : 답변 유형 (answer-planner 가 분류)
 *   - `StructuredAnswer`        : TS 타입
 *   - `StructuredAnswerSchema`  : Zod 검증기 (Validator 단계)
 *   - `STRUCTURED_ANSWER_FORMAT`: LLMClient `format` (vLLM json_schema, strict)
 *
 * 스트리밍 기본 경로(message-pipeline)는 이 스키마를 쓰지 않는다 — 그쪽은 토큰
 * 스트리밍 보존을 위해 chat/answer-format.ts 의 프롬프트 레이어를 사용한다.
 * 본 스키마는 opt-in 비스트리밍 Response Formatter Layer 전용.
 *
 * @module schemas/structured-answer.schema
 */
import { z } from 'zod';
import type { FormatOption } from '../llm/types';

export const ANSWER_INTENTS = [
    'decision',
    'explanation',
    'comparison',
    'troubleshooting',
    'technical_design',
    'summary',
    'drafting',
] as const;

export type AnswerIntent = (typeof ANSWER_INTENTS)[number];

const TableSchema = z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
});

const SectionSchema = z.object({
    heading: z.string(),
    body: z.string(),
    bullets: z.array(z.string()).optional(),
    table: TableSchema.optional(),
});

/**
 * 구조화 답변 Zod 검증기 (Validator). LLM 출력 파싱 후 이걸 통과해야 formatAnswer 로 넘어간다.
 */
export const StructuredAnswerSchema = z.object({
    intent: z.enum(ANSWER_INTENTS),
    title: z.string(),
    conclusion: z.string(),
    summary: z.string().optional().default(''),
    sections: z.array(SectionSchema),
    risks: z.array(z.string()).optional(),
    action_items: z.array(z.string()).optional(),
    confidence: z.enum(['high', 'medium', 'low']),
});

export type StructuredAnswer = z.infer<typeof StructuredAnswerSchema>;

/**
 * LLMClient `advancedOptions.format` 으로 전달할 JSON Schema (vLLM json_schema, strict).
 * stream-parser.toResponseFormat 가 { type:'json_schema', json_schema:{ schema:{ type:'object', properties, required } } } 로 변환.
 */
export const STRUCTURED_ANSWER_FORMAT: FormatOption = {
    type: 'object',
    properties: {
        intent: { type: 'string', enum: [...ANSWER_INTENTS] },
        title: { type: 'string' },
        conclusion: { type: 'string' },
        summary: { type: 'string' },
        sections: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    heading: { type: 'string' },
                    body: { type: 'string' },
                    bullets: { type: 'array', items: { type: 'string' } },
                    table: {
                        type: 'object',
                        properties: {
                            headers: { type: 'array', items: { type: 'string' } },
                            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                        },
                    },
                },
                required: ['heading', 'body'],
            },
        },
        risks: { type: 'array', items: { type: 'string' } },
        action_items: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['intent', 'title', 'conclusion', 'sections', 'confidence'],
};
