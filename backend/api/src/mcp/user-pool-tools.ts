/**
 * UserMCPPool 순회 → 각 client 의 도구를 `displayName::tool` 네임스페이스로 수집.
 * 동일 user 내 server.name 충돌 시 두 번째부터 server.id 끝 6자리 suffix.
 */
import type { UserMCPPool } from './user-pool';
import type { MCPTool } from './types';
import { MCP_NAMESPACE_SEPARATOR } from './types';

export interface UserPoolToolEntry {
    tool: MCPTool;
    serverId: string;
    displayName: string;
    catalogTemplateId?: string;
    originalToolName: string;
}

export function collectUserPoolTools(pool: UserMCPPool, userId: string): UserPoolToolEntry[] {
    const entries: UserPoolToolEntry[] = [];
    const nameSeen = new Map<string, number>();

    for (const [serverId, client] of pool.forUser(userId)) {
        const tools = client.getTools();
        const cfg = client.getConfig();
        const baseName = cfg.name || serverId;
        const catalogTemplateId = cfg.catalog_template_id;

        const seen = nameSeen.get(baseName) ?? 0;
        const displayName = seen === 0 ? baseName : `${baseName} (${serverId.slice(-6)})`;
        nameSeen.set(baseName, seen + 1);

        for (const tool of tools) {
            entries.push({
                tool: { ...tool, name: `${displayName}${MCP_NAMESPACE_SEPARATOR}${tool.name}` },
                serverId,
                displayName,
                catalogTemplateId,
                originalToolName: tool.name,
            });
        }
    }
    return entries;
}
