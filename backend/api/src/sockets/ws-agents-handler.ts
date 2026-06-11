/**
 * WebSocket 에이전트 목록 처리
 * MCP 도구 목록(내장 + 외부)을 에이전트 형식으로 변환하여 전송합니다.
 * @module sockets/ws-agents-handler
 */
import { WebSocket } from 'ws';
import { getUnifiedMCPClient } from '../mcp';
import { createLogger } from '../utils/logger';
import { ExtendedWebSocket } from './ws-types';

/**
 * 'request_agents' 메시지를 처리합니다.
 * MCP 도구 목록을 에이전트 형식(local:// 또는 mcp:// URL)으로 변환해 전송합니다.
 * @param ws - WebSocket 클라이언트 인스턴스
 * @param log - 호출 측 로거
 */
export async function handleRequestAgents(
    ws: WebSocket,
    log: ReturnType<typeof createLogger>
): Promise<void> {
    try {
        const mcpClient = getUnifiedMCPClient();
        const toolRouter = mcpClient.getToolRouter();
        const extWs = ws as ExtendedWebSocket;
        const userId = extWs._authenticatedUserId;
        const userTier = extWs._authenticatedUserTier;
        const allTools = userId && userTier
            ? await toolRouter.getAllTools({ userId, tier: userTier })
            : await toolRouter.getAllTools();

        const agents = allTools.map(tool => {
            // 외부 도구: mcp://serverName/toolName
            if (toolRouter.isExternalTool(tool.name)) {
                const [serverName, ...rest] = tool.name.split('::');
                const originalName = rest.join('::');
                return {
                    url: `mcp://${serverName}/${originalName}`,
                    name: tool.name,
                    description: tool.description,
                    external: true,
                };
            }
            // 내장 도구: local://toolName
            return {
                url: `local://${tool.name}`,
                name: tool.name,
                description: tool.description,
                external: false,
            };
        });

        ws.send(JSON.stringify({
            type: 'agents',
            agents
        }));
        log.debug(`[WS] 에이전트 목록 전송: ${agents.length}개 (내장: ${agents.filter(a => !a.external).length}, 외부: ${agents.filter(a => a.external).length})`);
    } catch (e: unknown) {
        log.error('[WS] 에이전트 목록 조회 실패:', (e instanceof Error ? e.message : String(e)));
    }
}
