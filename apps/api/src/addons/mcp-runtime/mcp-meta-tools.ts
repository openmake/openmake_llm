/**
 * MCP 진행적 공개(progressive disclosure) 메타 도구 — 하이브리드 정책 B.
 *
 * 자동 노출(getAllowedTools)은 cap 으로 도구 수를 제한하므로, 다(多)서버 사용자는 특정
 * 서버의 도구가 cap 밖으로 밀릴 수 있다. 이 메타 도구 2개로 LLM 이 on-demand 로 임의
 * 서버의 도구를 발견(mcp_list_tools)하고 호출(mcp_call)할 수 있게 한다 — 함수 스키마
 * 슬롯 1~2개만 쓰면서 무제한 서버 도구에 접근. MCP_PROGRESSIVE_DISCLOSURE_ENABLED 게이트.
 *
 * 의존(unified-client/user-pool)은 순환 import 회피를 위해 핸들러 내부 dynamic import.
 */
import type { MCPToolDefinition, MCPToolResult } from '../../tool-contract/types';
import { MCP_NAMESPACE_SEPARATOR } from '../../tool-contract/types';

export const MCP_META_TOOL_NAMES = ['mcp_list_tools', 'mcp_call'] as const;
/** resources/prompts 메타 도구(F13.2) — 상시 노출이 아니라 의도 턴(MCP_RESOURCE_INTENT_PATTERNS)에만. */
export const MCP_RESOURCE_META_TOOL_NAMES = ['mcp_list_resources', 'mcp_read_resource', 'mcp_get_prompt'] as const;

function text(t: string): MCPToolResult {
    return { content: [{ type: 'text', text: t }] };
}

/** mcp- / mcp_ prefix 무시 + 소문자 정규화 (displayName 매칭). */
function norm(s: string): string {
    return s.toLowerCase().replace(/^mcp[-_]/, '');
}

const mcpListToolsTool: MCPToolDefinition = {
    tool: {
        name: 'mcp_list_tools',
        description: '설치한 MCP 서버의 도구 목록을 조회합니다. 쓰고 싶은 서버 도구가 현재 노출 목록에 없을 때, server 이름으로 그 서버의 전체 도구(이름·설명·입력 스키마)를 받은 뒤 mcp_call 로 호출하세요. server 를 비우면 설치된 서버 이름 목록만 반환합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string', description: '조회할 MCP 서버 이름(displayName). 비우면 서버 목록 반환.' },
            },
            required: [],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const userId = context?.userId != null ? String(context.userId) : undefined;
        if (!userId || userId === 'guest') return text('로그인 사용자만 MCP 서버 도구를 조회할 수 있습니다.');
        const { getUnifiedMCPClient } = await import('./unified-client');
        const router = getUnifiedMCPClient().getToolRouter();
        const groups = router.getUserPoolToolGroups(userId);
        // "없습니다"만 반환하면 모델이 "검색/도구 불가 환경"으로 오일반화해 내장 도구까지
        // 안 쓰는 환각을 확증시킨다(2026-07-17 Discord 사례) — 내장 도구 가용을 함께 명시.
        //
        // 빈 그룹은 "미설치"와 "이번 실행에서 풀이 아직 안 채워짐"을 구분하지 못한다. 후자를
        // 미설치로 단정하자 모델이 설치돼 있는 서버를 두고 작업을 포기했다. DB 기준 설치 여부를
        // 확인해 두 경우를 다르게 안내한다. 조회 실패는 기존 문구로 폴백(graceful).
        if (groups.length === 0) {
            let installed: string[] = [];
            try {
                const { McpCatalogRepository } = await import('../../data/repositories/mcp-catalog-repository');
                const { getUnifiedDatabase } = await import('../../data/models/unified-database');
                const rows = await new McpCatalogRepository(getUnifiedDatabase().getPool()).listUserServers(userId);
                installed = rows.filter(r => r.enabled).map(r => r.name);
            } catch { /* 조회 실패 — 아래 기본 문구 */ }

            if (installed.length > 0) {
                return text(
                    `설치된 MCP 서버(${installed.join(', ')})가 이번 실행에서 아직 준비되지 않았습니다. `
                    + '미설치가 아니므로 "서버가 없다"고 단정하지 마세요. 현재 도구 목록에 해당 서버 도구가 '
                    + '보이면 그대로 호출하고, 보이지 않으면 잠시 후 다시 이 도구로 확인하거나 내장 도구로 진행하세요.',
                );
            }
            return text(
                '설치된 외부 MCP 서버가 없습니다. 단, 기본 내장 도구(현재 도구 목록의 web_search 등)는 '
                + 'MCP 설치와 무관하게 지금 바로 사용할 수 있습니다. 웹 검색이 필요하면 web_search 도구를 직접 호출하세요.',
            );
        }

        const server = typeof args.server === 'string' ? args.server.trim() : '';
        if (!server) return text('설치된 MCP 서버: ' + groups.map(g => g.displayName).join(', '));

        const g = groups.find(x => norm(x.displayName) === norm(server) || x.displayName.toLowerCase() === server.toLowerCase());
        if (!g) return text(`서버 '${server}' 를 찾을 수 없습니다. 설치된 서버: ${groups.map(x => x.displayName).join(', ')}`);

        const { collectUserPoolTools } = await import('./user-pool-tools');
        const { getUserMCPPool } = await import('./user-pool');
        const detail = collectUserPoolTools(getUserMCPPool(), userId)
            .filter(e => e.displayName === g.displayName)
            .map(e => ({ tool: e.originalToolName, description: e.tool.description, inputSchema: e.tool.inputSchema }));
        return text(
            `'${g.displayName}' 서버 도구 — mcp_call 로 호출 시 server="${g.displayName}", tool=아래 이름, args=그 도구 입력:\n` +
            JSON.stringify(detail, null, 2),
        );
    },
};

const mcpCallTool: MCPToolDefinition = {
    tool: {
        name: 'mcp_call',
        description: '설치한 MCP 서버의 도구를 이름으로 호출합니다. 현재 노출 목록에 없는 서버 도구를 쓸 때 사용하세요(먼저 mcp_list_tools 로 server·tool·인자 스키마 확인). server=서버 displayName, tool=도구 원본 이름, args=그 도구의 입력 객체.',
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string', description: 'MCP 서버 이름(displayName)' },
                tool: { type: 'string', description: '호출할 도구 이름(원본 이름)' },
                args: { type: 'object', description: '도구 입력 인자 객체' },
            },
            required: ['server', 'tool'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const userId = context?.userId != null ? String(context.userId) : undefined;
        if (!userId || userId === 'guest') return text('로그인 사용자만 MCP 도구를 호출할 수 있습니다.');
        const server = typeof args.server === 'string' ? args.server.trim() : '';
        const tool = typeof args.tool === 'string' ? args.tool.trim() : '';
        if (!server || !tool) return text('server 와 tool 이 필요합니다.');
        const toolArgs = (args.args && typeof args.args === 'object') ? args.args as Record<string, unknown> : {};

        const { getUnifiedMCPClient } = await import('./unified-client');
        const router = getUnifiedMCPClient().getToolRouter();
        const g = router.getUserPoolToolGroups(userId)
            .find(x => norm(x.displayName) === norm(server) || x.displayName.toLowerCase() === server.toLowerCase());
        if (!g) return text(`서버 '${server}' 를 찾을 수 없습니다.`);

        // 네임스페이스 이름으로 재구성 → executeTool 의 user-pool 해석 경로 재사용.
        const namespaced = `${g.displayName}${MCP_NAMESPACE_SEPARATOR}${tool}`;
        return router.executeTool(namespaced, toolArgs, context);
    },
};

/** displayName → 사용자 풀 클라이언트. 도구가 0개인 서버는 그룹에 없으므로 서버 이름으로도 찾는다. */
async function resolveUserClient(userId: string, server: string) {
    const { getUnifiedMCPClient } = await import('./unified-client');
    const { collectUserPoolTools } = await import('./user-pool-tools');
    const { getUserMCPPool } = await import('./user-pool');
    const pool = getUserMCPPool();
    const match = (n: string) => norm(n) === norm(server) || n.toLowerCase() === server.toLowerCase();
    const g = getUnifiedMCPClient().getToolRouter().getUserPoolToolGroups(userId).find((x) => match(x.displayName));
    if (g) {
        const entry = collectUserPoolTools(pool, userId).find((e) => e.displayName === g.displayName);
        const client = entry ? pool.get(userId, entry.serverId) : undefined;
        if (client) return client;
    }
    for (const [, client] of pool.forUser(userId)) if (match(client.getStatus().serverName)) return client;
    return undefined;
}

function requireUser(context: { userId?: unknown } | undefined): string | MCPToolResult {
    const userId = context?.userId != null ? String(context.userId) : undefined;
    if (!userId || userId === 'guest') return text('로그인 사용자만 MCP 서버 리소스·프롬프트를 조회할 수 있습니다.');
    return userId;
}

const serverProp = { server: { type: 'string', description: 'MCP 서버 이름(displayName) — mcp_list_tools 로 확인' } };

const mcpListResourcesTool: MCPToolDefinition = {
    tool: {
        name: 'mcp_list_resources',
        description: '설치한 MCP 서버가 제공하는 리소스(파일·문서·데이터 URI) 목록을 조회합니다. 서버가 resources 기능을 광고하지 않으면 오류 텍스트를 돌려줍니다. 읽기는 mcp_read_resource.',
        inputSchema: { type: 'object', properties: { ...serverProp }, required: ['server'] },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const u = requireUser(context); if (typeof u !== 'string') return u;
        const server = typeof args.server === 'string' ? args.server.trim() : '';
        const client = server ? await resolveUserClient(u, server) : undefined;
        if (!client) return text(`서버 '${server}' 를 찾을 수 없습니다.`);
        const { listResources } = await import('./external-resources');
        return listResources(client);
    },
};

const mcpReadResourceTool: MCPToolDefinition = {
    tool: {
        name: 'mcp_read_resource',
        description: 'MCP 서버 리소스를 uri 로 읽습니다(mcp_list_resources 의 uri). 텍스트는 그대로, 바이너리는 크기만 알려줍니다.',
        inputSchema: { type: 'object', properties: { ...serverProp, uri: { type: 'string', description: '리소스 URI' } }, required: ['server', 'uri'] },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const u = requireUser(context); if (typeof u !== 'string') return u;
        const server = typeof args.server === 'string' ? args.server.trim() : '';
        const uri = typeof args.uri === 'string' ? args.uri.trim() : '';
        if (!uri) return text('uri 가 필요합니다.');
        const client = server ? await resolveUserClient(u, server) : undefined;
        if (!client) return text(`서버 '${server}' 를 찾을 수 없습니다.`);
        const { readResource } = await import('./external-resources');
        return readResource(client, uri);
    },
};

const mcpGetPromptTool: MCPToolDefinition = {
    tool: {
        name: 'mcp_get_prompt',
        description: 'MCP 서버가 제공하는 프롬프트 템플릿을 가져옵니다. name 을 비우면 프롬프트 목록을 돌려주고, name 과 arguments 를 주면 렌더된 메시지를 돌려줍니다.',
        inputSchema: {
            type: 'object',
            properties: { ...serverProp, name: { type: 'string', description: '프롬프트 이름(비우면 목록)' }, arguments: { type: 'object', description: '프롬프트 인자(문자열 값)' } },
            required: ['server'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const u = requireUser(context); if (typeof u !== 'string') return u;
        const server = typeof args.server === 'string' ? args.server.trim() : '';
        const client = server ? await resolveUserClient(u, server) : undefined;
        if (!client) return text(`서버 '${server}' 를 찾을 수 없습니다.`);
        const { listPrompts, getPrompt } = await import('./external-resources');
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) return listPrompts(client);
        const raw = args.arguments && typeof args.arguments === 'object' ? args.arguments as Record<string, unknown> : {};
        const strArgs = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
        return getPrompt(client, name, strArgs);
    },
};

export const mcpMetaTools: MCPToolDefinition[] = [mcpListToolsTool, mcpCallTool, mcpListResourcesTool, mcpReadResourceTool, mcpGetPromptTool];
