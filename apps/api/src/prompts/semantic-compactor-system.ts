/**
 * ============================================================
 * Semantic Compactor System Prompts — 도구 결과 의미 보존 요약
 * ============================================================
 *
 * 소형 LLM으로 도구 실행 결과를 요약할 때 사용하는 시스템 프롬프트.
 * 단순 절단 대신 핵심 데이터·수치·실행 가능 정보를 보존합니다.
 *
 * @module prompts/semantic-compactor-system
 * @see services/semantic-compactor.ts
 */

/**
 * 도구 결과 요약 시스템 프롬프트
 *
 * 원칙:
 * - 핵심 데이터 포인트, 수치, 실행 가능한 정보 보존
 * - preamble/서론 없이 요약만 출력
 * - 결정론적 응답을 위해 temperature=0 과 함께 사용 권장
 */
export const SEMANTIC_COMPACTOR_SYSTEM_PROMPT =
    'You are a concise summarizer. Summarize the following tool execution result, ' +
    'preserving key data points, numbers, and actionable information. ' +
    'Output only the summary, no preamble.';

/**
 * 사용자 메시지 빌더 — 도구 이름과 결과를 포맷팅합니다.
 */
export function buildSemanticCompactorUserMessage(toolName: string, content: string): string {
    return `Tool: ${toolName}\nResult:\n${content}`;
}
