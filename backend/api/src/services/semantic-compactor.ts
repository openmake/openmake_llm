/**
 * ============================================================
 * Semantic Compactor — 의미 보존 도구 결과 압축
 * ============================================================
 *
 * Anthropic 하네스 원칙: "오래된 도구 결과를 요약하여
 * 컨텍스트 윈도우의 신호 대 잡음 비율을 유지"
 *
 * 단순 절단(truncation) 대신 소형 LLM을 사용하여
 * 핵심 정보를 보존하는 요약을 생성합니다.
 *
 * @module services/semantic-compactor
 */
import { OllamaClient } from '../ollama/client';
import { TOOL_RESULT_COMPACTION } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';

const logger = createLogger('SemanticCompactor');

/**
 * 도구 결과를 소형 모델로 의미 보존 요약합니다.
 *
 * @param toolName - 도구 이름 (요약 프롬프트에 포함)
 * @param content - 원본 도구 결과 텍스트
 * @returns 요약된 텍스트 (실패 시 단순 절단 폴백)
 */
export async function semanticCompact(toolName: string, content: string): Promise<string> {
    // 임계값 미만이면 단순 절단
    if (content.length < TOOL_RESULT_COMPACTION.SEMANTIC_THRESHOLD_CHARS) {
        return `[Compacted] ${toolName}: ${content.substring(0, TOOL_RESULT_COMPACTION.COMPACTED_MAX_CHARS)}...`;
    }

    try {
        const client = new OllamaClient({ model: TOOL_RESULT_COMPACTION.COMPACTOR_MODEL });
        const result = await client.chat(
            [
                {
                    role: 'system',
                    content: 'You are a concise summarizer. Summarize the following tool execution result, preserving key data points, numbers, and actionable information. Output only the summary, no preamble.',
                },
                {
                    role: 'user',
                    content: `Tool: ${toolName}\nResult:\n${content}`,
                },
            ],
            {
                temperature: 0,
                num_predict: TOOL_RESULT_COMPACTION.SEMANTIC_MAX_TOKENS,
            },
        );

        const summary = result.content?.trim();
        if (summary && summary.length > 0) {
            logger.info(`📦 Semantic compaction: ${toolName} (${content.length}자 → ${summary.length}자)`);
            return `[Summarized] ${toolName}: ${summary}`;
        }

        // 빈 응답 → 단순 절단 폴백
        return `[Compacted] ${toolName}: ${content.substring(0, TOOL_RESULT_COMPACTION.COMPACTED_MAX_CHARS)}...`;
    } catch (e) {
        // 소형 모델 실패 → 단순 절단 폴백 (graceful degradation)
        logger.warn(`⚠️ Semantic compaction 실패 (${toolName}), 단순 절단 폴백:`, e instanceof Error ? e.message : e);
        return `[Compacted] ${toolName}: ${content.substring(0, TOOL_RESULT_COMPACTION.COMPACTED_MAX_CHARS)}...`;
    }
}
