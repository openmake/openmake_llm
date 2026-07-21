/**
 * qwen 도구 호출 텍스트-누출 보정 — 모델이 구조화 tool_calls 대신 도구 호출을 XML 텍스트로
 * (content 에) 뱉는 결함을 파싱해 실행 가능한 ToolCall[] 로 승격한다. 이 결함이 나면 bash/python
 * 이 실제로 실행되지 않아 파일이 안 만들어지고(→ 다운로드할 산출물 없음), 사용자는 "생성했다는데
 * 다운로드가 안 된다"를 겪는다. 두 포맷 지원: Anthropic(<invoke name>) · Hermes(<tool_call>{json}).
 *
 * @module services/agent-task/text-tool-calls
 */
import type { ToolCall } from '../../llm/types';

/** content 에 도구 호출 XML 텍스트가 있으면 실행 가능한 ToolCall[] 로 파싱. 없으면 빈 배열. */
export function recoverTextToolCalls(content: string): ToolCall[] {
    if (!content) return [];
    const calls: ToolCall[] = [];
    let seq = 0;

    // Anthropic: <invoke name="X"> <parameter name="P">V</parameter> ... </invoke>
    const invokeRe = /<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>/g;
    for (let m: RegExpExecArray | null; (m = invokeRe.exec(content)) !== null;) {
        const name = m[1];
        const args: Record<string, unknown> = {};
        const paramRe = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/g;
        for (let p: RegExpExecArray | null; (p = paramRe.exec(m[2])) !== null;) {
            args[p[1]] = p[2].trim();
        }
        calls.push({ type: 'function', id: `rec_${seq++}`, function: { name, arguments: args } });
    }

    // Hermes: <tool_call>{"name":"X","arguments":{...}}</tool_call>
    const hermesRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    for (let m: RegExpExecArray | null; (m = hermesRe.exec(content)) !== null;) {
        try {
            const j = JSON.parse(m[1]) as { name?: unknown; arguments?: unknown };
            if (j && typeof j.name === 'string') {
                calls.push({
                    type: 'function', id: `rec_${seq++}`,
                    function: { name: j.name, arguments: (j.arguments ?? {}) as Record<string, unknown> },
                });
            }
        } catch { /* JSON 파싱 실패 — 무시 */ }
    }
    return calls;
}
