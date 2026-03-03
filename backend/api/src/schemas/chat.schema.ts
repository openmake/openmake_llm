/**
 * ============================================================
 * Chat Schema - 채팅 요청 Zod 검증 스키마
 * ============================================================
 *
 * POST /api/chat 및 POST /api/chat/stream 요청 본문의
 * 유효성을 검증하는 Zod 스키마를 정의합니다.
 *
 * @module schemas/chat.schema
 */
import { z } from 'zod';
import { secureOptionalTextSchema, secureTextSchema } from './security.schema';

/**
 * OpenAI 호환 tool_call 스키마 (히스토리 메시지 내 assistant의 tool_calls)
 * @property {string} id - 도구 호출 고유 ID (예: "call_abc123")
 * @property {string} type - 호출 타입 ("function")
 * @property {object} function - 호출할 함수 정보
 */
const toolCallInMessageSchema = z.object({
    id: secureTextSchema({ minLength: 1, maxLength: 200, fieldName: 'tool_call.id', allowNewLines: false, detectMaliciousPatterns: false }),
    type: z.literal('function'),
    function: z.object({
        name: secureTextSchema({ minLength: 1, maxLength: 128, fieldName: 'tool_call.function.name', allowNewLines: false, detectMaliciousPatterns: false }),
        arguments: secureTextSchema({ maxLength: 200000, fieldName: 'tool_call.function.arguments', allowHtmlLikeContent: true, detectMaliciousPatterns: false }),
    }),
});

/**
 * 대화 히스토리 내 개별 메시지 스키마
 * @property {string} role - 메시지 역할 (user, assistant, system, tool)
 * @property {string|null} content - 메시지 내용 (tool_calls 시 null 허용)
 * @property {Array} [tool_calls] - assistant가 요청한 도구 호출 목록 (OpenAI 호환)
 * @property {string} [tool_call_id] - tool 역할 메시지의 도구 호출 ID 참조
 */
const chatMessageSchema = z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: secureTextSchema({ maxLength: 100000, fieldName: 'content', allowHtmlLikeContent: true, detectMaliciousPatterns: false }).or(z.null()).optional().default(''),
    tool_calls: z.array(toolCallInMessageSchema).optional(),
    tool_call_id: secureOptionalTextSchema({ maxLength: 200, fieldName: 'tool_call_id', allowNewLines: false, detectMaliciousPatterns: false }),
});

/**
 * OpenAI 호환 함수 파라미터 JSON Schema 스키마
 * 유연하게 검증 (실제 JSON Schema 구조는 LLM에 전달 시 그대로 사용)
 */
const functionParametersSchema = z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
}).passthrough();

/**
 * OpenAI 호환 도구 정의 스키마
 * @property {string} type - 도구 타입 ("function")
 * @property {object} function - 함수 정의 (name, description, parameters, strict)
 */
const toolDefinitionSchema = z.object({
    type: z.literal('function'),
    function: z.object({
        name: secureTextSchema({ minLength: 1, maxLength: 64, fieldName: 'function.name', allowNewLines: false, detectMaliciousPatterns: false }),
        description: secureOptionalTextSchema({ maxLength: 5000, fieldName: 'function.description', allowHtmlLikeContent: true, detectMaliciousPatterns: false }),
        parameters: functionParametersSchema.optional(),
        strict: z.boolean().optional(),
    }),
});

/**
 * OpenAI 호환 tool_choice 스키마
 * - "auto": 모델이 자동 결정 (기본값)
 * - "none": 도구 호출 안 함
 * - "required": 반드시 도구 호출
 * - {type: "function", function: {name: "..."}} : 특정 도구 강제 호출
 */
const toolChoiceSchema = z.union([
    z.enum(['auto', 'none', 'required']),
    z.object({
        type: z.literal('function'),
        function: z.object({
            name: secureTextSchema({ minLength: 1, maxLength: 64, fieldName: 'tool_choice.function.name', allowNewLines: false, detectMaliciousPatterns: false }),
        }),
    }),
]);

/**
 * 채팅 요청 본문 스키마
 * @property {string} message - 사용자 메시지 (1~100,000자, 필수)
 * @property {Array} [history] - 이전 대화 히스토리
 * @property {string} [model] - 사용할 브랜드 모델 (예: openmake_llm_auto)
 * @property {string} [nodeId] - 특정 클러스터 노드 ID
 * @property {string} [sessionId] - 기존 대화 세션 ID
 * @property {string} [anonSessionId] - 비로그인 사용자 세션 ID
 * @property {string} [docId] - 문서 컨텍스트 ID (문서 Q&A 시)
 * @property {string[]} [images] - Base64 인코딩된 이미지 목록 (Vision 모델용)
 * @property {boolean} [discussionMode] - 다중 모델 토론 모드 활성화
 * @property {boolean} [thinkingMode] - Ollama Native Thinking 활성화
 * @property {string} [thinkingLevel] - 사고 깊이 수준 (low/medium/high)
 * @property {boolean} [webSearch] - 웹 검색 컨텍스트 주입 활성화
 * @property {Array} [tools] - OpenAI 호환 도구 정의 배열 (외부 Tool Calling용)
 * @property {string|object} [tool_choice] - 도구 호출 제어 ("auto"|"none"|"required"|{...})
 */
export const chatRequestSchema = z.object({
    message: secureTextSchema({ minLength: 1, maxLength: 100000, fieldName: 'message', allowHtmlLikeContent: true, detectMaliciousPatterns: false }),
    history: z.array(chatMessageSchema).optional(),
    model: secureOptionalTextSchema({ maxLength: 200, fieldName: 'model', allowNewLines: false, detectMaliciousPatterns: false }),
    nodeId: secureOptionalTextSchema({ maxLength: 200, fieldName: 'nodeId', allowNewLines: false, detectMaliciousPatterns: false }),
    sessionId: secureOptionalTextSchema({ maxLength: 500, fieldName: 'sessionId', allowNewLines: false, detectMaliciousPatterns: false }),
    anonSessionId: secureOptionalTextSchema({ maxLength: 500, fieldName: 'anonSessionId', allowNewLines: false, detectMaliciousPatterns: false }),
    docId: secureOptionalTextSchema({ maxLength: 500, fieldName: 'docId', allowNewLines: false, detectMaliciousPatterns: false }),
    images: z.array(z.string()).optional(),
    discussionMode: z.boolean().optional(),
    thinkingMode: z.boolean().optional(),
    thinkingLevel: z.enum(['low', 'medium', 'high']).optional(),
    webSearch: z.boolean().optional(),
    tools: z.array(toolDefinitionSchema).optional(),
    tool_choice: toolChoiceSchema.optional(),
});

/** 채팅 요청 TypeScript 타입 (Zod 스키마로부터 추론) */
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
