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
    sandbox_network?: 'full' | 'none' | 'host';
    /** 채팅 자동 노출 도구 화이트리스트 — 카탈로그 템플릿(tool_allowlist)에서 spawn 시 복사 */
    tool_allowlist?: string[];
}

export type ClientFactory = (config: ServerSpawnConfig) => ExternalMCPClient;

export interface SupervisorDeps {
    userPool: UserMCPPool;
    repo: Pick<McpCatalogRepository, 'listUserServers' | 'getServerById' | 'decryptEnvForSpawn' | 'recordInstanceTransition' | 'getCatalogToolAllowlist'>;
    clientFactory: ClientFactory;
}

export interface LifecycleSupervisor {
    onUserLogin(userId: string): Promise<void>;
    onUserLogout(userId: string): Promise<void>;
    onChatStart(userId: string, chatId: string): Promise<void>;
    ensureUserServers(userId: string, ctx?: string): Promise<void>;
    onChatEnd(userId: string, chatId: string): Promise<void>;
    spawnUserServer(userId: string, serverId: string): Promise<ExternalMCPClient>;
    killUserServer(userId: string, serverId: string): Promise<void>;
    getUserClient(userId: string, serverId: string): ExternalMCPClient | undefined;
    shutdownAll(): Promise<void>;
}

type ServerWithLifecycle = UserMcpServerRow & { lifecycle?: McpLifecycle };

/**
 * command/args 의 `{{env.KEY}}` placeholder 를 복호화된 env 값으로 치환.
 *
 * secret(connection string·토큰 등)을 env_schema(암호화 저장)로 받되, 위치 인자로
 * 전달해야 하는 MCP 서버(예: @modelcontextprotocol/server-postgres 는 URL 을 argv 로
 * 받음)를 지원한다 — 평문을 args(미암호화) 에 저장하지 않고 spawn 시점에만 주입.
 */
const ENV_PLACEHOLDER_RE = /\{\{env\.(\w+)\}\}/g;
function substituteEnvPlaceholders(value: string, env: Record<string, string>): string {
    return value.replace(ENV_PLACEHOLDER_RE, (_m, key: string) => env[key] ?? '');
}

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
            // lifecycle 미지정(컬럼 부재) 서버는 per_session 으로 간주 — safeSpawn 의
            // 기본값(?? 'per_session')과 동일 규칙. strict 비교만 하면 from-catalog 로
            // 등록된 auto_spawn 서버가 재시작/재로그인 후 영원히 복구되지 않는다.
            (((s as ServerWithLifecycle).lifecycle ?? 'per_session') === 'per_session') &&
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
        await this.ensureUserServers(userId, `chat=${chatId}`);
    }

    /**
     * 사용자의 auto_spawn(per_chat/per_session) MCP 서버를 풀에 ensure.
     * per_chat 뿐 아니라 per_session(lifecycle 컬럼 부재 시 기본) 도 포함 — 세션 도중
     * 카탈로그 설치/프로세스 재시작으로 풀이 비워졌을 때 재로그인 없이 도구를 복구한다.
     * safeSpawn 멱등 가드로 이미 살아있는 클라이언트는 재spawn 하지 않는다. onChatEnd 는
     * per_chat 만 kill 하므로 per_session 은 onUserLogout 까지 유지된다.
     *
     * onChatStart(채팅 시작) 외에 도구 picker 엔드포인트도 호출 — 목록 표시 전 풀 보장.
     */
    async ensureUserServers(userId: string, ctx = ''): Promise<void> {
        const servers = await this.repo.listUserServers(userId);
        const targets = servers.filter(s => {
            if (s.user_id !== userId || s.auto_spawn !== true || s.enabled !== true) return false;
            const lc = (s as ServerWithLifecycle).lifecycle ?? 'per_session';
            return lc === 'per_chat' || lc === 'per_session';
        });
        const perChat = targets.filter(s => ((s as ServerWithLifecycle).lifecycle ?? 'per_session') === 'per_chat').length;
        logger.info(`ensureUserServers u=${userId} ${ctx}: spawn 후보 ${targets.length}개 (per_chat ${perChat})`);
        await Promise.all(targets.map(s => this.safeSpawn(userId, s.id).catch(e => {
            logger.warn(`ensureUserServers spawn 실패 s=${s.id}: ${e}`);
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
        // 멱등 가드 — 이미 풀에 "살아있는" 클라이언트가 있으면 재spawn 하지 않는다
        // (로그인 반복 시 자식 프로세스 중복 생성/누수 방지).
        // self-heal: transport 가 exit/error 로 죽었다고 표시된(status!=='connected')
        // client 는 evict 후 respawn — 죽은 client 를 그대로 반환해 도구가 영구
        // "Not connected" 로 남던 갭을 막는다. (조용한 死는 tool-router 의
        // evict-on-error 가 실제 호출 실패로 보완.)
        const existing = this.userPool.get(userId, serverId);
        if (existing) {
            if (existing.getStatus().status === 'connected') return existing;
            logger.warn(`stale client evict u=${userId} s=${serverId} (status=${existing.getStatus().status}) → respawn`);
            await this.userPool.remove(userId, serverId);
        }
        const server = await this.repo.getServerById(serverId);
        if (!server) throw new Error(`server not found: ${serverId}`);
        const env = await this.repo.decryptEnvForSpawn(serverId);

        const lifecycle = (server as ServerWithLifecycle).lifecycle ?? 'per_session';

        // 카탈로그 템플릿의 채팅 노출 화이트리스트 — spawn 시점 조회라 카탈로그 수정이
        // user row snapshot 문제 없이 다음 respawn 부터 반영된다. is_enabled 와 무관하게
        // 조회한다(비활성화된 카탈로그가 오히려 노출 제한을 해제하는 fail-open 방지).
        // 조회 오류(일시 DB 장애)만 전체 노출로 폴백하고 경고를 남긴다.
        let toolAllowlist: string[] | undefined;
        if (server.catalog_template_id) {
            try {
                toolAllowlist = await this.repo.getCatalogToolAllowlist(server.catalog_template_id) ?? undefined;
            } catch (e) {
                logger.warn(`tool_allowlist 조회 실패 — 전체 노출 폴백 s=${serverId}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        const config: ServerSpawnConfig = {
            id: server.id,
            user_id: userId,
            name: server.name,
            transport_type: server.transport_type,
            // {{env.KEY}} placeholder 를 복호화 env 로 치환 (위치 인자 secret 주입 지원).
            command: server.command ? substituteEnvPlaceholders(server.command, env) : server.command,
            args: Array.isArray(server.args)
                ? server.args.map(a => typeof a === 'string' ? substituteEnvPlaceholders(a, env) : a)
                : server.args,
            env,
            url: server.url,
            lifecycle,
            catalog_template_id: server.catalog_template_id ?? undefined,
            sandbox_network: (() => { const n = (server as ServerWithLifecycle).sandbox_network; return n === 'none' || n === 'host' ? n : 'full'; })(),
            tool_allowlist: toolAllowlist,
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
