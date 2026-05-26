/**
 * MCP Lifecycle Supervisor — 사용자별 MCP 서버 프로세스 spawn/kill 관리.
 *
 * Lifecycle 분리 (P7-D3):
 *   - per_session : onUserLogin 에서 spawn, onUserLogout 에서 kill
 *   - per_chat    : onChatStart 에서 spawn, onChatEnd 에서 kill
 *   - long_lived  : 서버 부팅 시 (initializeFromDB) spawn — 본 supervisor 영역 외
 *
 * Crash detection (P7-D5):
 *   - ExternalMCPClient (EventEmitter) 의 'exit'/'error' 이벤트 listen
 *   - crash 감지 시: 풀에서 제거 + mcp_server_instances 에 'crashed' 기록
 *
 * 자동 재시작 (P7-D8): off by default — crash 시 풀 제거만, 명시적 /start 만 재시작.
 *
 * 참조: docs/superpowers/plans/2026-05-20-phase7-lifecycle-supervisor.md §5
 */
import type { UserMCPPool } from './user-pool';
import type { ExternalMCPClient } from './external-client';
import type { McpCatalogRepository, UserMcpServerRow } from '../data/repositories/mcp-catalog-repository';
import { createLogger } from '../utils/logger';

const logger = createLogger('LifecycleSupervisor');

export type McpLifecycle = 'per_chat' | 'per_session' | 'long_lived';

export interface ServerSpawnConfig {
    id: string;
    user_id: string;
    name: string;
    transport_type: 'stdio' | 'sse' | 'streamable-http';
    command?: string | null;
    args?: unknown[] | null;
    env?: Record<string, string> | null;
    url?: string | null;
    lifecycle?: McpLifecycle;
    catalog_template_id?: string;
}

export type ClientFactory = (config: ServerSpawnConfig) => ExternalMCPClient;

export interface SupervisorDeps {
    userPool: UserMCPPool;
    repo: Pick<McpCatalogRepository, 'listUserServers' | 'getServerById' | 'decryptEnvForSpawn' | 'recordInstanceTransition'>;
    clientFactory: ClientFactory;
}

export interface LifecycleSupervisor {
    onUserLogin(userId: string): Promise<void>;
    onUserLogout(userId: string): Promise<void>;
    onChatStart(userId: string, chatId: string): Promise<void>;
    onChatEnd(userId: string, chatId: string): Promise<void>;
    spawnUserServer(userId: string, serverId: string): Promise<ExternalMCPClient>;
    killUserServer(userId: string, serverId: string): Promise<void>;
    getUserClient(userId: string, serverId: string): ExternalMCPClient | undefined;
    shutdownAll(): Promise<void>;
}

type ServerWithLifecycle = UserMcpServerRow & { lifecycle?: McpLifecycle };

export class MCPLifecycleSupervisor implements LifecycleSupervisor {
    private readonly userPool: UserMCPPool;
    private readonly repo: SupervisorDeps['repo'];
    private readonly clientFactory: ClientFactory;
    private readonly chatOwners = new Map<string, string>();

    constructor(deps: SupervisorDeps) {
        this.userPool = deps.userPool;
        this.repo = deps.repo;
        this.clientFactory = deps.clientFactory;
    }

    async onUserLogin(userId: string): Promise<void> {
        const servers = await this.repo.listUserServers(userId);
        const targets = servers.filter(s =>
            s.user_id === userId &&
            (s as ServerWithLifecycle).lifecycle === 'per_session' &&
            s.auto_spawn === true &&
            s.enabled === true,
        );
        logger.info(`onUserLogin u=${userId}: per_session 후보 ${targets.length}개`);
        await Promise.all(targets.map(s => this.safeSpawn(userId, s.id).catch(e => {
            logger.warn(`spawn 실패 u=${userId} s=${s.id}: ${e}`);
        })));
    }

    async onUserLogout(userId: string): Promise<void> {
        logger.info(`onUserLogout u=${userId}: ${this.userPool.size()} 활성 풀`);
        const entries = [...this.userPool.forUser(userId)];
        for (const [serverId] of entries) {
            await this.repo.recordInstanceTransition(serverId, userId, 'stopped').catch(() => { /* noop */ });
        }
        await this.userPool.closeUser(userId);
    }

    async onChatStart(userId: string, chatId: string): Promise<void> {
        this.chatOwners.set(chatId, userId);
        const servers = await this.repo.listUserServers(userId);
        const targets = servers.filter(s =>
            s.user_id === userId &&
            (s as ServerWithLifecycle).lifecycle === 'per_chat' &&
            s.auto_spawn === true &&
            s.enabled === true,
        );
        logger.info(`onChatStart u=${userId} chat=${chatId}: per_chat 후보 ${targets.length}개`);
        await Promise.all(targets.map(s => this.safeSpawn(userId, s.id).catch(e => {
            logger.warn(`per_chat spawn 실패 s=${s.id}: ${e}`);
        })));
    }

    async onChatEnd(userId: string, chatId: string): Promise<void> {
        this.chatOwners.delete(chatId);
        const servers = await this.repo.listUserServers(userId);
        const targets = servers.filter(s =>
            s.user_id === userId &&
            (s as ServerWithLifecycle).lifecycle === 'per_chat',
        );
        for (const s of targets) {
            if (this.userPool.has(userId, s.id)) {
                await this.killUserServer(userId, s.id).catch(e => {
                    logger.warn(`per_chat kill 실패 s=${s.id}: ${e}`);
                });
            }
        }
    }

    async spawnUserServer(userId: string, serverId: string): Promise<ExternalMCPClient> {
        const existing = this.userPool.get(userId, serverId);
        if (existing) return existing;
        const server = await this.repo.getServerById(serverId);
        if (!server) throw new Error(`server not found: ${serverId}`);
        if (server.user_id !== userId) {
            throw new Error(`서버 소유자 불일치: u=${userId} owner=${server.user_id}`);
        }
        return this.safeSpawn(userId, serverId);
    }

    async killUserServer(userId: string, serverId: string): Promise<void> {
        if (!this.userPool.has(userId, serverId)) return;
        await this.repo.recordInstanceTransition(serverId, userId, 'stopped').catch(() => { /* noop */ });
        await this.userPool.remove(userId, serverId);
    }

    getUserClient(userId: string, serverId: string): ExternalMCPClient | undefined {
        return this.userPool.get(userId, serverId);
    }

    async shutdownAll(): Promise<void> {
        logger.info(`shutdownAll: 전체 풀 정리 (size=${this.userPool.size()})`);
        await this.userPool.closeAll();
    }

    private async safeSpawn(userId: string, serverId: string): Promise<ExternalMCPClient> {
        const server = await this.repo.getServerById(serverId);
        if (!server) throw new Error(`server not found: ${serverId}`);
        const env = await this.repo.decryptEnvForSpawn(serverId);

        const lifecycle = (server as ServerWithLifecycle).lifecycle ?? 'per_session';
        const config: ServerSpawnConfig = {
            id: server.id,
            user_id: userId,
            name: server.name,
            transport_type: server.transport_type,
            command: server.command,
            args: server.args,
            env,
            url: server.url,
            lifecycle,
            catalog_template_id: server.catalog_template_id ?? undefined,
        };

        await this.repo.recordInstanceTransition(serverId, userId, 'starting').catch(() => { /* noop */ });
        const client = this.clientFactory(config);

        // Crash detection — transport 의 exit/error 이벤트 forward
        const onExit = (code?: number, _signal?: NodeJS.Signals | null, reason?: string): void => {
            const last = `exit code=${code ?? '?'} reason=${reason ?? ''}`.trim();
            logger.warn(`crash 감지 u=${userId} s=${serverId}: ${last}`);
            this.repo.recordInstanceTransition(serverId, userId, 'crashed', undefined, last).catch(() => { /* noop */ });
            void this.userPool.remove(userId, serverId);
        };
        client.on?.('exit', onExit);
        client.on?.('error', (err: unknown) => onExit(undefined, null, String(err)));

        await client.connect();
        this.userPool.add(userId, serverId, client);
        await this.repo.recordInstanceTransition(serverId, userId, 'running').catch(() => { /* noop */ });
        logger.info(`spawn 완료 u=${userId} s=${serverId}`);
        return client;
    }
}

let _instance: LifecycleSupervisor | null = null;

export function setLifecycleSupervisor(sv: LifecycleSupervisor): void {
    _instance = sv;
}

export function getLifecycleSupervisor(): LifecycleSupervisor | null {
    return _instance;
}
