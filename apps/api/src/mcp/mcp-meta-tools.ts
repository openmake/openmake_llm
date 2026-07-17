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
import type { MCPToolDefinition, MCPToolResult } from './types';
import { MCP_NAMESPACE_SEPARATOR } from './types';

export const MCP_META_TOOL_NAMES = ['mcp_list_tools', 'mcp_call'] as const;

function text(t: string): MCPToolResult {
    return { content: [{ type: 'text', text: t }] };
}

/** mcp- / mcp_ prefix 무시 + 소문자 정규화 (displayName 매칭). */
function norm(s: string): string {
    return s.toLowerCase().replace(/^mcp[-_]/, '');
}

export const mcpListToolsTool: MCPToolDefinition = {
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
        if (groups.length === 0) {
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

export const mcpCallTool: MCPToolDefinition = {
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

export const mcpMetaTools: MCPToolDefinition[] = [mcpListToolsTool, mcpCallTool];
