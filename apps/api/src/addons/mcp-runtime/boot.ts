/**
 * MCP Runtime add-on 부팅 진입점 — 매니페스트 `entry.runtime` 이 가리킨다 (2026-09-19).
 *
 * ① Base 도구 포트에 MCP 런타임 등록 ② MCP 메타 도구를 내장 도구로 기여 ③ 외부 서버 연결·샌드박스 점검.
 * 이 add-on 이 꺼지면 셋 다 일어나지 않고 Base 는 내장 도구만 아는 런타임으로 돈다 —
 * 외부 MCP 서버 연결 없음, `::` 도구 실행 불가, MCP 관리 API 404.
 *
 * @module addons/mcp-runtime/boot
 */
import type { AddonRuntimeHandle } from '../../addon-host';
import { registerToolRuntime } from '../../runtime-ports/tool-runtime';
import { contributeBuiltInTools } from '../../runtime-ports/builtin-tool-contributions';
import type { MCPToolDefinition } from '../../tool-contract/types';
import { createLogger } from '../../utils/logger';
import { mcpToolRuntime } from './runtime';
import { mcpMetaTools } from './mcp-meta-tools';
import { importMcpServerFromGitTool } from './mcp-server-ingest-tool';

const logger = createLogger('McpRuntimeAddon');

export async function startMcpRuntime(): Promise<AddonRuntimeHandle> {
    registerToolRuntime(mcpToolRuntime);
    contributeBuiltInTools('mcp-runtime', [
        ...mcpMetaTools,
        importMcpServerFromGitTool as MCPToolDefinition,
    ]);
    logger.info('MCP Tool Runtime 등록 완료');

    // 외부 서버 연결·샌드박스 점검은 실패해도 서비스가 계속 뜬다(fail-open) — 호스트가 오류를 로그로 남긴다.
    const { startToolRuntime } = await import('./runtime-boot');
    await startToolRuntime();

    return {
        // 사용자별 연결·child 프로세스는 이미 supervisor 가 관리한다 — 정지는 런타임 정리(외부 연결 해제·사용자 풀 종료)에 위임한다.
        // 여러 번 불려도 안전하다(연결·풀이 비어 있으면 빈 반복).
        async stop() {
            await mcpToolRuntime.shutdown();
            logger.info('MCP Tool Runtime 정지 — 외부 연결·사용자 풀 정리');
        },
        // resume 은 두지 않는다: 외부 서버 재연결·supervisor 재기동이 부팅 절차에만 있어 다시 켜려면 재시작한다(restart_required).
    };
}
