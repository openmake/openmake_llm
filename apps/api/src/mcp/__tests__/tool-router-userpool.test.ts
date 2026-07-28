/**
 * ToolRouter ↔ UserMCPPool 통합 테스트
 *
 * Task 3 (Phase 7 lifecycle): userContext 가 있을 때
 *   - userPool.forUser 순회 → collectUserPoolTools 로 displayName::tool 수집
 *   - 구독 등급(tier) 제거 후: 모든 user-pool 도구를 제한 없이 노출
 *
 */
import { ToolRouter } from '../tool-router';
import type { UserMCPPool } from '../user-pool';
import type { MCPTool } from '../types';

function fakePoolWithClient(
    serverId: string,
    serverName: string,
    tools: MCPTool[],
    catalogTemplateId?: string,
    toolAllowlist?: string[],
): UserMCPPool {
    const client = {
        getStatus: () => ({ serverId, serverName, status: 'connected', toolCount: tools.length }),
        getTools: () => tools,
        getConfig: () => ({
            id: serverId,
            name: serverName,
            catalog_template_id: catalogTemplateId,
            transport_type: 'stdio',
            tool_allowlist: toolAllowlist,
        }),
    };
    return {
        forUser: function* (_uid: string) {
            yield [serverId, client];
        },
    } as unknown as UserMCPPool;
}

function mkTool(name: string): MCPTool {
    return { name, description: '', inputSchema: { type: 'object', properties: {} } };
}

describe('ToolRouter.getAllTools with userContext', () => {
    it('userContext 없이 호출 시 기존 동작 (builtin + global external)', async () => {
        const r = new ToolRouter();
        const tools = await r.getAllTools();
        expect(Array.isArray(tools)).toBe(true);
        // builtin 도구 일부 존재 (web_search 또는 web_scrape)
        expect(tools.some(t => t.name === 'web_search' || t.name === 'web_scrape')).toBe(true);
    });

    it('userContext 있으면 userPool 도구가 제한 없이 포함 (catalog 템플릿)', async () => {
        const pool = fakePoolWithClient(
            'mcp_3_xyz',
            'Firecrawl-MCP-Server',
            [{ name: 'scrape', description: '', inputSchema: { type: 'object', properties: {} } }],
            'mcp-firecrawl',
        );
        const r = new ToolRouter({ userPool: pool });
        const tools = await r.getAllTools({ userId: 'user-1' });
        expect(tools.some(t => t.name === 'Firecrawl-MCP-Server::scrape')).toBe(true);
    });

    it('catalog_template_id null (direct 등록) 도구도 포함', async () => {
        const pool = fakePoolWithClient(
            'mcp_3_xyz',
            'CustomServer',
            [{ name: 'do', description: '', inputSchema: { type: 'object', properties: {} } }],
            undefined,
        );
        const r = new ToolRouter({ userPool: pool });
        const tools = await r.getAllTools({ userId: 'user-1' });
        expect(tools.some(t => t.name === 'CustomServer::do')).toBe(true);
    });
});

describe('ToolRouter.getUserPoolToolGroups tool_allowlist', () => {
    // 서버가 알파벳순으로 batch → notebook_describe → notebook_list 를 보고해도
    // 채팅 자동 노출 그룹은 allowlist 항목만, allowlist 순서로 정렬돼야 한다
    // (첫 도구가 round-robin 대표 — notebook_list 우선 보장).
    it('allowlist 밖 도구 제외 + allowlist 순서 정렬', () => {
        const pool = fakePoolWithClient(
            'mcp_3_nlm',
            'notebooklm',
            [mkTool('batch'), mkTool('notebook_describe'), mkTool('notebook_list'), mkTool('studio_create')],
            'mcp-notebooklm',
            ['notebook_list', 'notebook_describe'],
        );
        const r = new ToolRouter({ userPool: pool });
        const groups = r.getUserPoolToolGroups('user-1');
        expect(groups).toHaveLength(1);
        expect(groups[0].shortNames).toEqual(['notebook_list', 'notebook_describe']);
        expect(groups[0].tools).toEqual(['notebooklm::notebook_list', 'notebooklm::notebook_describe']);
    });

    it('allowlist 미정의 서버는 전체 노출 (기존 동작 유지)', () => {
        const pool = fakePoolWithClient(
            'mcp_3_xyz',
            'CustomServer',
            [mkTool('b'), mkTool('a')],
            undefined,
            undefined,
        );
        const r = new ToolRouter({ userPool: pool });
        const groups = r.getUserPoolToolGroups('user-1');
        expect(groups[0].shortNames).toEqual(['b', 'a']); // 서버 보고 순서 그대로
    });

    it('allowlist 0매칭(도구 rename/오타)이면 전체 노출 폴백 — 서버 소멸 방지', () => {
        const pool = fakePoolWithClient(
            'mcp_3_nlm',
            'notebooklm',
            [mkTool('notebook_list_v2'), mkTool('batch')],
            'mcp-notebooklm',
            ['notebook_list'], // 라이브 도구와 하나도 안 맞음
        );
        const r = new ToolRouter({ userPool: pool });
        const groups = r.getUserPoolToolGroups('user-1');
        expect(groups).toHaveLength(1); // 그룹이 사라지면 mcp_list_tools/mcp_call 해석 불가
        expect(groups[0].shortNames).toEqual(['notebook_list_v2', 'batch']);
    });

    it('allowlist 가 걸려도 getAllTools(실행 경로)는 전체 도구 유지', async () => {
        const pool = fakePoolWithClient(
            'mcp_3_nlm',
            'notebooklm',
            [mkTool('batch'), mkTool('notebook_list')],
            'mcp-notebooklm',
            ['notebook_list'],
        );
        const r = new ToolRouter({ userPool: pool });
        const tools = await r.getAllTools({ userId: 'user-1' });
        expect(tools.some(t => t.name === 'notebooklm::batch')).toBe(true);
        expect(tools.some(t => t.name === 'notebooklm::notebook_list')).toBe(true);
    });
});
