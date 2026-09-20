/**
 * MCP Tool Runtime 구현 — Base 포트(`runtime-ports/tool-runtime`)에 꽂히는 어댑터 (2026-09-19).
 *
 * Base 의 내장 전용 런타임을 대체해 **외부 MCP 서버**(전역·사용자 풀)를 도구 목록과 실행에 더한다.
 * 거버넌스(서킷·역할 게이트·훅·오류 분류·경로 샌드박스·인자 검증·감사)는 여전히 Base 를 통과한다 —
 * 여기서 하는 일은 외부 라우팅·수명주기·메타 도구 정규화뿐이다.
 *
 * @module addons/mcp-runtime/runtime
 */
import type { MCPToolResult, UserContext } from '../../tool-contract/types';
import { MCP_NAMESPACE_SEPARATOR } from '../../tool-contract/types';
import type { ToolDefinition } from '../../llm/types';
import type { ToolRuntime, ToolSummary, ToolUserInputContext } from '../../runtime-ports/tool-runtime';
import { createLogger } from '../../utils/logger';
import { getUnifiedMCPClient } from './index';
import { getLifecycleSupervisor } from './lifecycle-supervisor';
import { runWithElicitationContext } from './elicitation-bridge';
import { MCP_META_TOOL_NAMES } from './mcp-meta-tools';

const logger = createLogger('McpToolRuntime');

/** 메타 도구 `mcp_call` — 모델이 서버·도구를 인자로 지목하는 진행적 공개 형태 */
const MCP_CALL_TOOL_NAME = MCP_META_TOOL_NAMES[1];

/** supervisor 훅은 미초기화(부팅 직후·테스트)면 조용히 건너뛴다 — 인증·채팅 흐름을 막지 않는다. */
async function withSupervisor(label: string, fn: (sv: NonNullable<ReturnType<typeof getLifecycleSupervisor>>) => Promise<void>): Promise<void> {
    const sv = getLifecycleSupervisor();
    if (!sv) return;
    try { await fn(sv); } catch (e) { logger.warn(`${label} 훅 실패`, e); }
}

export const mcpToolRuntime: ToolRuntime = {
    async listLLMTools(userContext?: { userId: string }): Promise<ToolDefinition[]> {
        const router = getUnifiedMCPClient().getToolRouter();
        return (userContext ? await router.getLLMTools(userContext) : await router.getLLMTools()) as unknown as ToolDefinition[];
    },

    executeTool(name: string, args: Record<string, unknown>, context: UserContext): Promise<MCPToolResult> {
        return getUnifiedMCPClient().executeToolWithContext(name, args, context);
    },

    async listTools(userContext?: { userId: string }): Promise<ToolSummary[]> {
        const router = getUnifiedMCPClient().getToolRouter();
        const tools = userContext ? await router.getAllTools(userContext) : await router.getAllTools();
        return tools.map(t => ({
            name: t.name,
            description: t.description,
            external: t.name.includes(MCP_NAMESPACE_SEPARATOR),
        }));
    },

    /** 서버가 요청한 사용자 입력(elicitation)을 승인함으로 잇는 문맥 안에서 실행한다. */
    runWithUserInputContext<T>(ctx: ToolUserInputContext, fn: () => Promise<T>): Promise<T> {
        return runWithElicitationContext(ctx, fn);
    },

    /** `mcp_call { server, tool, args }` → `server::tool` 실제 호출로 푼다. 그 외는 그대로. */
    normalizeToolCall(name: string, args: Record<string, unknown>): { name: string; args: Record<string, unknown> } {
        if (name !== MCP_CALL_TOOL_NAME) return { name, args };
        const inner = args.args && typeof args.args === 'object' ? args.args as Record<string, unknown> : {};
        return {
            name: `${String(args.server ?? '')}${MCP_NAMESPACE_SEPARATOR}${String(args.tool ?? '')}`,
            args: inner,
        };
    },

    getUserToolGroups(userId: string): Array<{ displayName: string; tools: string[]; shortNames: string[] }> {
        return getUnifiedMCPClient().getToolRouter().getUserPoolToolGroups(userId);
    },

    async callUserServerTool(userId: string, serverId: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult | null> {
        const sv = getLifecycleSupervisor();
        if (!sv) return null;
        const client = await sv.spawnUserServer(userId, serverId);
        return client.callTool(toolName, args);
    },

    async onUserLogin(userId: string): Promise<void> {
        await withSupervisor('onUserLogin', sv => sv.onUserLogin(userId));
    },
    async onUserLogout(userId: string): Promise<void> {
        await withSupervisor('onUserLogout', sv => sv.onUserLogout(userId));
    },
    async onChatStart(userId: string, chatId: string): Promise<void> {
        await withSupervisor('onChatStart', sv => sv.onChatStart(userId, chatId));
    },
    async onChatEnd(userId: string, chatId: string): Promise<void> {
        await withSupervisor('onChatEnd', sv => sv.onChatEnd(userId, chatId));
    },
    /**
     * 에이전트 작업 실행 직전 사용자 풀 보장 — 채팅과 달리 반드시 await 한다.
     * 일회성 실행이라 도구 목록을 모으는 시점에 풀이 비어 있으면 그 실행 내내 user MCP 도구가 없다
     * (실측: mcp_list_tools 가 "설치된 서버 없음" 을 반환해 모델이 작업을 포기했다).
     */
    async ensureUserToolsForTask(userId: string, taskId: string): Promise<void> {
        await withSupervisor('ensureUserToolsForTask', sv => sv.ensureUserServers(userId, `task=${taskId}`));
    },

    /** listen 완료 후 1회 — 사용자 MCP 풀 supervisor 기동(멱등). */
    async onServerReady(): Promise<void> {
        const { startMcpLifecycleSupervisor } = await import('./runtime-boot');
        await startMcpLifecycleSupervisor();
    },

    async shutdown(): Promise<void> {
        try {
            await getUnifiedMCPClient().getServerRegistry().disconnectAll();
        } catch (e) { logger.warn('외부 MCP 서버 연결 해제 실패', e); }
        const sv = getLifecycleSupervisor();
        if (sv) {
            try { await sv.shutdownAll(); } catch (e) { logger.warn('사용자 MCP 풀 정리 실패', e); }
        }
    },
};
