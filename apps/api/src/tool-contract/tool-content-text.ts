/**
 * 도구 결과 content → 모델에 줄 텍스트 (PURE).
 *
 * text 항목은 원문 그대로 잇고 비텍스트(image·resource 등)만 JSON 으로 싣는다. content 배열을 통째로
 * JSON.stringify 하면 줄바꿈·따옴표가 이스케이프돼 길이가 늘고, 모델·작업 스텝에
 * `Error: [{"type":"text","text":"오류: …"}]` 처럼 JSON 이 노출된다(2026-10-24).
 * 채팅 경로(external-tool-exec)와 에이전트 작업 경로(task-steps runTool)가 함께 쓴다.
 *
 * @module tool-contract/tool-content-text
 */
import type { MCPToolResult } from './types';

export function toolContentToText(content: MCPToolResult['content'] | string): string {
    if (typeof content === 'string') return content;
    // 배열이 아닌 값(계약 밖)은 종전처럼 JSON 으로 싣는다
    if (!Array.isArray(content)) return JSON.stringify(content);
    return content
        .map((c) => ((c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string'
            ? (c as { text: string }).text
            : JSON.stringify(c)))
        .join('\n');
}
