/**
 * 확장 MCP 서버 정책 포트(§8-3) — add-on 의 MCP 서버 등록 경로(git 설치·카탈로그 from-catalog)가 Base 의 단일 검사를 부르는 길.
 *
 * 검사·정책 해석은 Base(services/extensions/mcp-server-policy)에 있고, add-on 은 이 포트만 안다(Base 내부 직접 import 금지).
 * 강제 OFF(EXTENSION_MCP_SERVER_POLICY_ENFORCED) 면 아무 것도 하지 않는다. 거절은 403 `EXTENSION_MCP_SERVER_BLOCKED` 예외.
 *
 * @module runtime-ports/extension-mcp-server-policy
 */
import { assertMcpServerAllowed, type McpServerSpec } from '../services/extensions/mcp-server-policy';

export { EXTENSION_MCP_SERVER_BLOCKED_CODE } from '../config/extension-mcp-server-policy';
export type { McpServerSpec } from '../services/extensions/mcp-server-policy';

/**
 * MCP 서버 등록 전 검사 — 저장·spawn·연결 **전에** 부른다. `server` 를 함수로 주면 강제 ON 일 때만 계산한다
 * (렌더·검증이 OFF 경로의 오류 순서를 바꾸지 않게).
 */
export function assertMcpServerRegistrationAllowed(req: { userId?: string; origin: 'git-ingest' | 'catalog'; server: McpServerSpec | (() => McpServerSpec) }): Promise<void> {
    return assertMcpServerAllowed(req);
}
