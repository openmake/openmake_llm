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
import { wrapEnvPlaceholdersAsShellRefs } from './env-placeholder-shell';
import { ToolRouter } from './tool-router';
import type { MCPServerConfig, MCPConnectionStatus } from './types';
import type { UnifiedDatabase, MCPServerRow } from '../data/models/unified-database';
import { decryptToken } from '../utils/token-crypto';
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
/**
 * env 값 중 암호문(v1:)만 복호화. 평문 값은 그대로 둔다.
 *
 * ⚠️ decryptToken 은 fail-open 이다 — 키 부재나 포맷 오류 시 예외 대신 **암호문을 그대로
 * 반환**한다(token-crypto.ts). 그대로 넘기면 암호문이 자식 프로세스 env 에 주입돼,
 * 서버는 뜨고 도구 목록도 등록되지만 실제 API 호출만 인증 실패하는 형태로 조용히 깨진다.
 * 그래서 복호화 후에도 v1: 이 남아 있으면 실패로 보고 throw 한다(fail-closed).
 * 호출자(initializeFromDB)가 서버 단위로 잡아 그 서버만 건너뛴다.
 */
function decryptEnvValues(env: Record<string, string> | null | undefined): Record<string, string> | undefined {
    if (!env) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
        if (typeof v !== 'string' || !v.startsWith('v1:')) {
            out[k] = v;
            continue;
        }
        const decrypted = decryptToken(v);
        if (decrypted.startsWith('v1:')) {
            throw new Error(`env "${k}" 복호화 실패 — 암호문이 그대로 남았습니다 (TOKEN_ENCRYPTION_KEY 설정 및 저장값 포맷을 확인하세요)`);
        }
        out[k] = decrypted;
    }
    return out;
}

function rowToConfig(row: MCPServerRow): MCPServerConfig {
    return {
        id: row.id,
        name: row.name,
        transport_type: row.transport_type as MCPServerConfig['transport_type'],
        command: row.command || undefined,
        args: row.args || undefined,
        // DB 원본은 secret 이 암호문(v1:)으로 저장돼 있으므로 복호화해서 넘긴다.
        // 빠뜨리면 암호문이 그대로 자식 프로세스 env 로 들어가, 서버는 뜨고 도구 목록도
        // 정상 등록되지만 실제 API 호출만 인증 실패하는 형태로 조용히 깨진다
        // (사용자풀 경로의 decryptEnvForSpawn 과 동일한 처리).
        env: decryptEnvValues(row.env),
        url: row.url || undefined,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
        sandbox_network: row.sandbox_network === 'none' || row.sandbox_network === 'host' ? row.sandbox_network : 'full',
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
            // 🔒 전역 서버만 전역 ToolRouter 에 등록. user_private/user_shared 는
            //   LifecycleSupervisor 가 userId 격리 풀로 spawn 하므로 여기서 제외한다
            //   (게스트/타 사용자 과노출 차단 + user_private 중복 spawn 제거).
            const servers = await db.getGlobalMcpServers();
            const enabledServers = servers.filter(s => s.enabled);

            logger.info(`Found ${enabledServers.length} enabled MCP servers in DB`);

            for (const server of enabledServers) {
                // rowToConfig 도 try 안에서 호출한다 — env 복호화가 실패하면 그 서버만
                // 건너뛰어야 하고, 루프 밖이면 예외가 바깥 catch 로 빠져 나머지 서버까지
                // 통째로 초기화되지 않는다.
                try {
                    const config = rowToConfig(server);
                    await this.connectServer(config.id, config);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    logger.error(`Failed to connect "${server.name}" during init:`, msg);
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

        // {{env.KEY}} 자리표시자는 값을 argv 에 박지 않고 sh 변수 참조로 감싼다(env-placeholder-shell).
        // 유저풀(lifecycle-supervisor)만 감싸고 전역 경로(부팅 initializeFromDB·수동 connect)는 리터럴이
        // 그대로 argv 로 내려가 spawn 이 실패하던 갭 — 2026-09-06. 자리표시자가 없으면 원본 그대로(멱등).
        const shellWrapped = config.command
            ? wrapEnvPlaceholdersAsShellRefs(config.command, Array.isArray(config.args) ? config.args : [])
            : null;
        const effective: MCPServerConfig = shellWrapped?.wrapped
            ? { ...config, command: shellWrapped.command, args: shellWrapped.args }
            : config;
        if (shellWrapped?.wrapped) {
            const missing = shellWrapped.keys.filter((k) => !(k in (config.env ?? {})));
            if (missing.length) logger.warn(`{{env.*}} 참조 키가 env 에 없음 (빈값으로 전개) s=${serverId}: ${missing.join(',')}`);
        }
        const client = new ExternalMCPClient(effective);
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
