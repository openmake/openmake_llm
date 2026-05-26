/**
 * UserMCPPool 순회 → 각 client 의 discoveredTools 를 `server.name::tool` 네임스페이스로 수집.
 * tier 게이트는 caller (tool-router) 가 catalog_template_id + required_tier 로 별도 처리.
 *
 * tool-router 의 동기 catalog 흐름에 통합되므로 본 helper 도 동기.
 */
import type { UserMCPPool } from './user-pool';
import type { MCPTool } from './types';

export interface UserPoolToolEntry {
    tool: MCPTool;
    serverId: string;
    serverName: string;
    catalogTemplateId?: string;
    originalToolName: string;
}

const NS_SEPARATOR = '::';

export function collectUserPoolTools(pool: UserMCPPool, userId: string): UserPoolToolEntry[] {
    const entries: UserPoolToolEntry[] = [];
    const nameSeen = new Map<string, number>();

    for (const [serverId, client] of pool.forUser(userId)) {
        const tools = (typeof (client as unknown as { getTools?: () => MCPTool[] }).getTools === 'function')
            ? (client as unknown as { getTools: () => MCPTool[] }).getTools()
            : [];
        const cfg = (client as unknown as { getConfig?: () => { id: string; name: string; catalog_template_id?: string } }).getConfig?.();
        const serverName = cfg?.name || serverId;
        const catalogTemplateId = cfg?.catalog_template_id;

        const seen = nameSeen.get(serverName) ?? 0;
        const effectiveName = seen === 0 ? serverName : `${serverName} (${serverId.slice(-6)})`;
        nameSeen.set(serverName, seen + 1);

        for (const tool of tools) {
            entries.push({
                tool: { ...tool, name: `${effectiveName}${NS_SEPARATOR}${tool.name}` },
                serverId,
                serverName: effectiveName,
                catalogTemplateId,
                originalToolName: tool.name,
            });
        }
    }
    return entries;
}
