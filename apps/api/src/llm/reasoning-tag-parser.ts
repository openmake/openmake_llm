/**
 * ============================================================
 * Reasoning Tag Parser — vLLM `--reasoning-parser` 미설정 환경의 defensive 안전망
 * ============================================================
 *
 * DeepSeek R1, Qwen3, Granite 3.2 등 reasoning 모델은 chat_template 에서
 * assistant turn 의 시작 토큰으로 `<think>` 를 prepend 합니다. 모델은 reasoning 후
 * `</think>` 닫고 본문을 이어 씁니다.
 *
 * vLLM 서버에 `--reasoning-parser deepseek_r1` (또는 qwen3, granite 등) 이 설정되면
 * vLLM 이 자동으로 `<think>...</think>` 블록을 `delta.reasoning` 필드로 분리합니다.
 *
 * 그러나 운영 환경에서 vLLM parser flag 가 *미설정* 이면 reasoning 토큰이 그대로
 * `delta.content` 에 흘러나옵니다 — 사용자가 chain-of-thought 를 보게 됩니다.
 *
 * 본 유틸리티는 vLLM parser 가 없을 때의 *client-side defensive 안전망* 입니다:
 *   - content 에 `</think>` 가 있으면 그 앞부분은 reasoning, 뒷부분은 actual content
 *   - chat_template 이 `<think>` 를 prepend 했으므로 opening 태그는 응답에 없음
 *   - 추가로 `<think>...</think>` 페어가 본문 중간에 있으면 그것도 분리
 *
 * @module llm/reasoning-tag-parser
 * @see https://docs.vllm.ai/en/latest/features/reasoning_outputs.html
 * @see https://docs.vllm.ai/en/latest/contributing/model/multimodal/  (deepseek_r1 패턴)
 */

/**
 * `<think>...</think>` (또는 chat_template prepend 패턴) 을 content 에서 분리.
 *
 * 처리 규칙:
 *   1. content 가 `<think>...</think>` 페어를 *완전 포함* 하면 → 페어 제거 + thinking 추가
 *   2. content 에 *orphan `</think>` 만* 있으면 (chat_template prepend 패턴) → `</think>` 앞부분 thinking, 뒷부분 content
 *   3. `</think>` 가 전혀 없으면 → 변경 없음
 *
 * @param content - LLM 응답의 raw content (reasoning + 실제 답변 혼합 가능성)
 * @returns 분리된 content 와 thinking
 */
export function parseReasoningTags(content: string): { content: string; thinking: string } {
    if (!content) return { content: '', thinking: '' };

    let cleaned = content;
    const thinkingParts: string[] = [];

    // 1. `<think>...</think>` 완전 페어 제거 (greedy 하지 않게 non-greedy, DOTALL).
    const fullPairPattern = /<think>([\s\S]*?)<\/think>/g;
    cleaned = cleaned.replace(fullPairPattern, (_match, inner) => {
        thinkingParts.push(inner.trim());
        return '';
    });

    // 2. Orphan `</think>` — chat_template 이 `<think>` 를 prepend 한 경우.
    //    `</think>` 앞부분 전체를 reasoning, 뒷부분을 content.
    const orphanCloseIdx = cleaned.indexOf('</think>');
    if (orphanCloseIdx >= 0) {
        const prefix = cleaned.slice(0, orphanCloseIdx).trim();
        if (prefix) thinkingParts.push(prefix);
        cleaned = cleaned.slice(orphanCloseIdx + '</think>'.length);
    }

    // 3. Orphan `<think>` (드물지만 chat_template 이 닫는 태그를 prepend 한 경우 등) — 무시 처리.
    cleaned = cleaned.replace(/<think>/g, '');

    return {
        content: cleaned.trim(),
        thinking: thinkingParts.join('\n').trim(),
    };
}
