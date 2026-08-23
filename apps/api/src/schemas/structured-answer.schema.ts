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

/**
 * strict json_schema 는 모든 키를 required 로 요구하므로 모델이 "값 없음"을 null 로 보낸다.
 * 그 null 을 미지정(undefined)과 동일하게 취급한다 — 기존 출력 타입(optional)은 그대로 유지.
 */
const nullToUndefined = (v: unknown): unknown => (v === null ? undefined : v);

const TableSchema = z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
});

const SectionSchema = z.object({
    heading: z.string(),
    body: z.string(),
    bullets: z.preprocess(nullToUndefined, z.array(z.string()).optional()),
    table: z.preprocess(nullToUndefined, TableSchema.optional()),
});

/**
 * 구조화 답변 Zod 검증기 (Validator). LLM 출력 파싱 후 이걸 통과해야 formatAnswer 로 넘어간다.
 */
export const StructuredAnswerSchema = z.object({
    intent: z.enum(ANSWER_INTENTS),
    title: z.string(),
    conclusion: z.string(),
    // 선택 필드는 null 도 수용한다 — OpenAI strict json_schema 는 모든 키를 required 로 요구하므로
    // 모델이 "값 없음"을 null 로 표현한다(아래 STRUCTURED_ANSWER_FORMAT 주석 참고).
    summary: z.preprocess(nullToUndefined, z.string().optional().default('')),
    sections: z.array(SectionSchema),
    risks: z.preprocess(nullToUndefined, z.array(z.string()).optional()),
    action_items: z.preprocess(nullToUndefined, z.array(z.string()).optional()),
    confidence: z.enum(['high', 'medium', 'low']),
});

export type StructuredAnswer = z.infer<typeof StructuredAnswerSchema>;

/**
 * LLMClient `advancedOptions.format` 으로 전달할 JSON Schema (json_schema, strict).
 *
 * ⚠️ **OpenAI strict 규격 준수 필수** (실측 2026-08-24): strict 모드는
 *   ① 모든 object 에 `additionalProperties: false`
 *   ② `required` 가 **모든** property 를 나열 (부분집합 불가)
 * 를 요구한다. 이를 어기면 OpenAI 계열(ChatGPT·OpenRouter)에서 스키마가 **강제되지 않고**
 * 모델이 필드를 빠뜨린다 — 실제로 `intent` 하나가 누락돼 검증 2회 실패 → degrade 했다.
 * (로컬 vLLM 의 guided decoding 은 더 관대해 이 위반이 드러나지 않았다.)
 *
 * 그래서 값이 선택적인 필드도 required 에 넣되 **null 을 허용**하고, Zod 쪽에서
 * null 을 미지정으로 정규화한다(위 nullToUndefined).
 */
const TABLE_SCHEMA = {
    type: ['object', 'null'],
    properties: {
        headers: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    },
    required: ['headers', 'rows'],
    additionalProperties: false,
};

const SECTION_SCHEMA = {
    type: 'object',
    properties: {
        heading: { type: 'string' },
        body: { type: 'string' },
        bullets: { type: ['array', 'null'], items: { type: 'string' } },
        table: TABLE_SCHEMA,
    },
    required: ['heading', 'body', 'bullets', 'table'],
    additionalProperties: false,
};

export const STRUCTURED_ANSWER_FORMAT: FormatOption = {
    type: 'object',
    properties: {
        intent: { type: 'string', enum: [...ANSWER_INTENTS] },
        title: { type: 'string' },
        conclusion: { type: 'string' },
        summary: { type: ['string', 'null'] },
        sections: { type: 'array', items: SECTION_SCHEMA },
        risks: { type: ['array', 'null'], items: { type: 'string' } },
        action_items: { type: ['array', 'null'], items: { type: 'string' } },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    // strict 규격: 모든 property 를 나열해야 한다 (선택 필드는 위에서 null 허용).
    required: ['intent', 'title', 'conclusion', 'summary', 'sections', 'risks', 'action_items', 'confidence'],
    additionalProperties: false,
};
