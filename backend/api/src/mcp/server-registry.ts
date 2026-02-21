/**
 * ============================================================
 * MCPServerRegistry - 외부 MCP 서버 연결 관리자
 * ============================================================
 *
 * DB에 저장된 외부 MCP 서버 설정을 로드하고, ExternalMCPClient 인스턴스를 관리하며,
 * ToolRouter에 도구를 자동 등록/해제합니다.
 *
 * @module mcp/server-registry
 * @description
 * - DB(mcp_servers 테이블)에서 활성 서버 설정 로드 및 자동 연결
 * - 서버 등록(DB 저장 + 연결), 해제(연결 끊기 + DB 삭제)
 * - 연결된 서버의 도구를 ToolRouter에 자동 등록
 * - 전체/개별 서버 연결 상태 모니터링 및 ping
 * - Graceful shutdown 시 전체 서버 연결 해제
 *
 * 생명주기:
 * 1. 앱 초기화: initializeFromDB() → DB에서 enabled 서버 로드 → 각 서버 connectServer()
 * 2. 런타임: registerServer() / unregisterServer() → 동적 추가/제거
 * 3. 종료: disconnectAll() → 모든 연결 정리
 */

import { ExternalMCPClient } from './external-client';
import { ToolRouter } from './tool-router';
import type { MCPServerConfig, MCPConnectionStatus } from './types';
import type { UnifiedDatabase, MCPServerRow } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('MCPRegistry');

/**
 * DB 행(MCPServerRow) → MCPServerConfig 변환
 *
 * UnifiedDatabase에서 조회한 원시 행 데이터를 MCPServerConfig 타입으로 변환합니다.
 *
 * @param row - DB에서 조회한 MCP 서버 행
 * @returns MCPServerConfig 형식의 서버 설정
 */
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

/**
 * 외부 MCP 서버 연결 관리 레지스트리
 *
 * ExternalMCPClient 인스턴스의 생명주기를 관리하고,
 * 연결된 서버의 도구를 ToolRouter에 자동 등록합니다.
 *
 * @class MCPServerRegistry
 */
export class MCPServerRegistry {
    /** 활성 연결 맵: serverId → ExternalMCPClient */
    private connections: Map<string, ExternalMCPClient> = new Map();
    /** 도구 라우터 참조 (도구 등록/해제용) */
    private toolRouter: ToolRouter;

    /**
     * MCPServerRegistry 인스턴스를 생성합니다.
     *
     * @param toolRouter - 도구 등록/해제에 사용할 ToolRouter 인스턴스
     */
    constructor(toolRouter: ToolRouter) {
        this.toolRouter = toolRouter;
    }

    /**
     * DB에서 enabled 서버를 로드하고 연결 시도
     *
     * 앱 초기화 시 한 번 호출됩니다.
     * 개별 서버 연결 실패는 전체 초기화를 중단하지 않습니다.
     *
     * @param db - UnifiedDatabase 인스턴스
     */
    async initializeFromDB(db: UnifiedDatabase): Promise<void> {
        try {
            const servers = await db.getMcpServers();
            const enabledServers = servers.filter(s => s.enabled);

            logger.info(`Found ${enabledServers.length} enabled MCP servers in DB`);

            for (const server of enabledServers) {
                const config = rowToConfig(server);
                try {
                    await this.connectServer(config.id, config);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    logger.error(`Failed to connect "${config.name}" during init:`, msg);
                    // 초기화 실패는 전체를 중단하지 않음
                }
            }
        } catch (error) {
            logger.error('Failed to initialize from DB:', error);
        }
    }

    /**
     * 새 서버 등록 (DB 저장 + 연결)
     *
     * DB에 서버 설정을 저장하고, enabled 상태이면 즉시 연결을 시도합니다.
     * 연결 실패해도 DB 등록은 유지됩니다.
     *
     * @param config - 등록할 서버 설정
     * @param db - UnifiedDatabase 인스턴스
     * @returns 서버 연결 상태
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
     * 서버 등록 해제 (연결 해제 + DB 삭제)
     *
     * 연결을 먼저 끊고, DB에서 서버 설정을 삭제합니다.
     *
     * @param serverId - 해제할 서버 ID
     * @param db - UnifiedDatabase 인스턴스
     */
    async unregisterServer(serverId: string, db: UnifiedDatabase): Promise<void> {
        await this.disconnectServer(serverId);
        await db.deleteMcpServer(serverId);
    }

    /**
     * 서버에 연결하고 도구를 ToolRouter에 등록
     *
     * 기존 연결이 있으면 먼저 해제한 후, 새로운 ExternalMCPClient를 생성합니다.
     * 연결 성공 시 검색된 도구를 ToolRouter에 자동 등록합니다.
     *
     * @param serverId - 서버 고유 ID
     * @param config - 서버 연결 설정
     * @throws {Error} 연결 실패 시
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
     * 서버 연결 해제 및 ToolRouter에서 도구 해제
     *
     * @param serverId - 해제할 서버 ID
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
     * 모든 서버 연결 해제 (Graceful Shutdown)
     *
     * Promise.allSettled로 병렬 해제하며, 개별 실패는 경고만 출력합니다.
     */
    async disconnectAll(): Promise<void> {
        const serverIds = [...this.connections.keys()];
        logger.info(`Disconnecting all ${serverIds.length} external servers...`);

        const results = await Promise.allSettled(
            serverIds.map(id => this.disconnectServer(id))
        );

        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
            logger.warn(`${failures.length} server(s) failed to disconnect cleanly`);
        }

        logger.info('All external servers disconnected');
    }

    /**
     * 모든 서버 연결 상태 반환
     *
     * @returns 활성 연결된 모든 서버의 MCPConnectionStatus 배열
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
     *
     * @param serverId - 조회할 서버 ID
     * @returns MCPConnectionStatus 또는 미연결 시 undefined
     */
    getServerStatus(serverId: string): MCPConnectionStatus | undefined {
        const client = this.connections.get(serverId);
        return client?.getStatus();
    }

    /**
     * 서버 연결 상태를 ping으로 확인
     *
     * @param serverId - ping할 서버 ID
     * @returns 정상 응답이면 true, 미연결이면 false
     */
    async pingServer(serverId: string): Promise<boolean> {
        const client = this.connections.get(serverId);
        if (!client) return false;
        return client.ping();
    }

    /**
     * 활성 연결 수 반환
     *
     * @returns 현재 연결된 외부 서버 수
     */
    getConnectionCount(): number {
        return this.connections.size;
    }

    /**
     * 특정 서버의 ExternalMCPClient 인스턴스 반환
     *
     * 테스트 또는 디버깅 목적으로 직접 클라이언트에 접근할 때 사용합니다.
     *
     * @param serverId - 조회할 서버 ID
     * @returns ExternalMCPClient 인스턴스 또는 미연결 시 undefined
     */
    getClient(serverId: string): ExternalMCPClient | undefined {
        return this.connections.get(serverId);
    }
}
