/**
 * MCP Runtime add-on 부팅 진입점 — 매니페스트 `entry.runtime` 이 가리킨다 (2026-09-19).
 *
 * ① Base 도구 포트에 MCP 런타임 등록 ② MCP 메타 도구를 내장 도구로 기여 ③ 외부 서버 연결·샌드박스 점검.
 * 이 add-on 이 꺼지면 셋 다 일어나지 않고 Base 는 내장 도구만 아는 런타임으로 돈다 —
 * 외부 MCP 서버 연결 없음, `::` 도구 실행 불가, MCP 관리 API 404.
 *
 * @module addons/mcp-runtime/boot
 */
import { registerToolRuntime } from '../../runtime-ports/tool-runtime';
import { contributeBuiltInTools } from '../../runtime-ports/builtin-tool-contributions';
import type { MCPToolDefinition } from '../../tool-contract/types';
import { createLogger } from '../../utils/logger';
import { mcpToolRuntime } from './runtime';
import { mcpMetaTools } from './mcp-meta-tools';
import { importMcpServerFromGitTool } from './mcp-server-ingest-tool';

const logger = createLogger('McpRuntimeAddon');

export async function startMcpRuntime(): Promise<void> {
    registerToolRuntime(mcpToolRuntime);
    contributeBuiltInTools('mcp-runtime', [
        ...mcpMetaTools,
        importMcpServerFromGitTool as MCPToolDefinition,
    ]);
    logger.info('MCP Tool Runtime 등록 완료');

    // 외부 서버 연결·샌드박스 점검은 실패해도 서비스가 계속 뜬다(fail-open) — 호스트가 오류를 로그로 남긴다.
    const { startToolRuntime } = await import('./runtime-boot');
    await startToolRuntime();
}
