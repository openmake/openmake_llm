/**
 * 고위험 MCP 서버 도구 역할 게이팅 — ChatService 에서 분리 (파일 크기 가드).
 *
 * 외부 공개 인스턴스에서 게스트·저권한 사용자에게 위험 도구(임의 코드 실행 등)가
 * 과노출되는 것을 차단한다. 정책·판정은 mcp/tool-role-gate 가 SoT(실행 경로와 공용).
 *
 * @module services/chat-service/tool-restrictions
 */
import { type ToolDefinition } from '../../llm';
import { isToolRestrictedForRole } from '../../mcp/tool-role-gate';

/**
 * 고위험 서버 도구(네임스페이스 "서버명::도구")를 역할 미달 사용자에게서 제거.
 * 외부 공개 인스턴스에서 게스트·저권한 사용자의 위험도구 과노출 차단.
 */
export function filterRestrictedTools(tools: ToolDefinition[], role?: string): ToolDefinition[] {
    return tools.filter((t) => !isToolRestrictedForRole(t.function.name, role));
}
