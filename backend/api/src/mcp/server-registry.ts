/**
 * MCPServerRegistry — 서버 연결 관리자
 * DB에서 서버 설정을 로드하고, ExternalMCPClient 인스턴스를 관리하며,
 * ToolRouter에 도구를 등록/해제합니다.
 */

import { ExternalMCPClient } from './external-client';
import { ToolRouter } from './tool-router';
import type { MCPServerConfig, MCPConnectionStatus } from './types';
import type { UnifiedDatabase, MCPServerRow } from '../data/models/unified-database';

/** MCPServerRow → MCPServerConfig 변환 */
function rowToConfig(row: MCPServerRow): MCPServerConfig {
    return {
        id: row.id,
        name: row.name,
        transport_type: row.transport_type as MCPServerConfig['transport_type'],
        command: row.command || undefined,
        args: row.args || undefined,
        env: row.env || undefined,
        url: row.url || undefined,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

export class MCPServerRegistry {
    /** 활성 연결: serverId → ExternalMCPClient */
    private connections: Map<string, ExternalMCPClient> = new Map();
    private toolRouter: ToolRouter;

    constructor(toolRouter: ToolRouter) {
        this.toolRouter = toolRouter;
    }

    /**
     * DB에서 enabled 서버를 로드하고 연결 시도
     * 앱 초기화 시 한 번 호출
     */
    async initializeFromDB(db: UnifiedDatabase): Promise<void> {
        try {
            const servers = await db.getMcpServers();
            const enabledServers = servers.filter(s => s.enabled);

            console.log(`[MCPRegistry] Found ${enabledServers.length} enabled MCP servers in DB`);

            for (const server of enabledServers) {
                const config = rowToConfig(server);
                try {
                    await this.connectServer(config.id, config);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error(`[MCPRegistry] Failed to connect "${config.name}" during init:`, msg);
                    // 초기화 실패는 전체를 중단하지 않음
                }
            }
        } catch (error) {
            console.error('[MCPRegistry] Failed to initialize from DB:', error);
        }
    }

    /**
     * 새 서버 등록 (DB 저장 + 연결)
     */
    async registerServer(config: MCPServerConfig, db: UnifiedDatabase): Promise<MCPConnectionStatus> {
        // DB에 저장
        await db.createMcpServer({
            id: config.id,
            name: config.name,
            transport_type: config.transport_type,
            command: config.command || null,
            args: config.args || null,
            env: config.env || null,
            url: config.url || null,
            enabled: config.enabled,
        });

        // 활성화 시 연결
        if (config.enabled) {
            try {
                await this.connectServer(config.id, config);
            } catch {
                // 연결 실패해도 등록은 유지
            }
        }

        return this.getServerStatus(config.id) || {
            serverId: config.id,
            serverName: config.name,
            status: 'disconnected',
            toolCount: 0,
        };
    }

    /**
     * 서버 등록 해제 (DB 삭제 + 연결 해제)
     */
    async unregisterServer(serverId: string, db: UnifiedDatabase): Promise<void> {
        await this.disconnectServer(serverId);
        await db.deleteMcpServer(serverId);
    }

    /**
     * 서버에 연결하고 도구를 ToolRouter에 등록
     */
    async connectServer(serverId: string, config: MCPServerConfig): Promise<void> {
        // 기존 연결이 있으면 먼저 해제
        if (this.connections.has(serverId)) {
            await this.disconnectServer(serverId);
        }

        const client = new ExternalMCPClient(config);
        this.connections.set(serverId, client);

        await client.connect();

        // 연결 성공 시 도구를 ToolRouter에 등록
        const tools = client.getTools();
        this.toolRouter.registerExternalTools(
            serverId,
            config.name,
            tools,
            (name, args) => client.callTool(name, args)
        );
    }

    /**
     * 서버 연결 해제 및 도구 해제
     */
    async disconnectServer(serverId: string): Promise<void> {
        const client = this.connections.get(serverId);
        if (client) {
            this.toolRouter.unregisterExternalTools(serverId);
            await client.disconnect();
            this.connections.delete(serverId);
        }
    }

    /**
     * 모든 서버 연결 해제 (graceful shutdown)
     */
    async disconnectAll(): Promise<void> {
        const serverIds = [...this.connections.keys()];
        console.log(`[MCPRegistry] Disconnecting all ${serverIds.length} external servers...`);

        const results = await Promise.allSettled(
            serverIds.map(id => this.disconnectServer(id))
        );

        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
            console.warn(`[MCPRegistry] ${failures.length} server(s) failed to disconnect cleanly`);
        }

        console.log('[MCPRegistry] All external servers disconnected');
    }

    /**
     * 모든 서버 연결 상태 반환
     */
    getAllStatuses(): MCPConnectionStatus[] {
        const statuses: MCPConnectionStatus[] = [];
        for (const client of this.connections.values()) {
            statuses.push(client.getStatus());
        }
        return statuses;
    }

    /**
     * 특정 서버 연결 상태 반환
     */
    getServerStatus(serverId: string): MCPConnectionStatus | undefined {
        const client = this.connections.get(serverId);
        return client?.getStatus();
    }

    /**
     * 서버 ping
     */
    async pingServer(serverId: string): Promise<boolean> {
        const client = this.connections.get(serverId);
        if (!client) return false;
        return client.ping();
    }

    /**
     * 활성 연결 수
     */
    getConnectionCount(): number {
        return this.connections.size;
    }

    /**
     * 특정 서버의 ExternalMCPClient 반환 (테스트 등에서 사용)
     */
    getClient(serverId: string): ExternalMCPClient | undefined {
        return this.connections.get(serverId);
    }
}
