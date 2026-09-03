/**
 * IProvider `responseFormat`(OpenAI `response_format` 원형) → LLMClient `format`(FormatOption) 역변환 (2026-09-03).
 *
 * 배경: `OpenAICompatProvider` 는 `responseFormat` 을 그대로 전송하지만 `LocalLLMProvider` 는 읽지 않아
 * provider 추상화로 로컬 모델에 스키마를 걸면 에러 없이 무시됐다(Qwen3.8 점검 4-4). 구조화 답변 라우트가
 * 로컬을 LLMClient 직접 호출로 우회해 실피해는 없었지만, 새 호출자가 IProvider 로 로컬에 스키마를 걸면
 * 조용히 실패하는 구멍이다. LLMClient 는 FormatOption 만 받으므로(`toResponseFormat` 이 다시 response_format
 * 으로 조립) 여기서 역변환한다. 변환 불가 형태(text·structural_tag 등)는 undefined — 호출자가 warn.
 *
 * @module providers/local-response-format
 */
import type { FormatOption } from '../llm/types';

export function toFormatOption(rf: Record<string, unknown> | undefined): FormatOption | undefined {
    if (!rf) return undefined;
    if (rf.type === 'json_object') return 'json';
    if (rf.type !== 'json_schema') return undefined;
    const js = rf.json_schema as { schema?: Record<string, unknown> } | undefined;
    const schema = js?.schema;
    if (!schema || typeof schema !== 'object' || schema.type !== 'object' || typeof schema.properties !== 'object' || !schema.properties) {
        return undefined;
    }
    return {
        type: 'object',
        properties: schema.properties as Record<string, unknown>,
        ...(Array.isArray(schema.required) ? { required: schema.required as string[] } : {}),
        ...(typeof schema.additionalProperties === 'boolean' ? { additionalProperties: schema.additionalProperties } : {}),
    };
}
