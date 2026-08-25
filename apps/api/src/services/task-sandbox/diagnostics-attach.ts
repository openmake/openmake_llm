/**
 * 편집 후 진단 부착 — 파일 쓰기 도구가 성공한 직후 실행기 진단을 결과에 덧붙인다.
 *
 * LSP diagnostics-first 1단계(plan `2026-08-26-openmake-code-lsp-diagnostics-plan.md`):
 * 그전까지 로컬 작업의 품질 신호는 셸 실행 결과(tsc/테스트)뿐이라 모델이 편집만 하고
 * "고쳤다"고 끝내는 실패가 남았다. 편집 직후 컴파일러 진단을 같은 tool_result 로 돌려주면
 * 하네스가 **같은 턴에** 고칠 수 있다.
 *
 * 설계상 중요한 두 가지:
 *   - **모델에 새 도구를 노출하지 않는다** — 기존 write 결과에 텍스트만 얹으므로 도구 수가
 *     늘지 않고, 로컬 qwen 의 도구폭주 hang 축과 무관하다.
 *   - **fail-open** — 실행기 미지원(샌드박스·구 디바이스)·게이트 OFF·타임아웃·예외는 모두
 *     원문 그대로 돌려준다. 진단 실패가 편집 결과를 가리지 않는다.
 *
 * @module services/task-sandbox/diagnostics-attach
 */
import type { TaskExecutor } from './executor';
import type { MCPToolResult } from '../../mcp/types';

function textResult(text: string): MCPToolResult {
    return { content: [{ type: 'text', text }], isError: false };
}

/**
 * @param sandbox 실행 백엔드 — `diagnostics` 를 구현한 실행기(로컬 브리지)만 진단을 붙인다.
 * @param relPath 방금 편집한 workspace 상대경로
 * @param text 원래 도구 결과 문구(`기록됨: a.ts` 등)
 */
export async function withDiagnostics(
    sandbox: TaskExecutor,
    relPath: string,
    text: string,
): Promise<MCPToolResult> {
    if (!sandbox.diagnostics) return textResult(text);
    try {
        const d = await sandbox.diagnostics([relPath]);
        return textResult(d ? `${text}\n${d.text}` : text);
    } catch {
        return textResult(text);
    }
}
