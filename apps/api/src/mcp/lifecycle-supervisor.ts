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
import { wrapEnvPlaceholdersAsShellRefs } from './env-placeholder-shell';
import type { ExternalMCPClient } from './external-client';
import type { McpCatalogRepository, UserMcpServerRow } from '../data/repositories/mcp-catalog-repository';
import { createLogger } from '../utils/logger';
import { classifyConnectError, serializeConnectError } from './connect-error';

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
    repo: Pick<McpCatalogRepository, 'listUserServers' | 'getServerById' | 'decryptEnvForSpawn' | 'recordInstanceTransition' | 'getCatalogToolAllowlist' | 'listAutoSpawnUserIds' | 'closeOrphanInstances'>;
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
    restoreOnBoot(): Promise<void>;
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

    /**
     * 단일 유저 서버 spawn — killUserServer 의 대칭(수동 [연결] 경로용).
     *
     * user 소유 서버는 **반드시 이 경로(userPool)** 로 띄워야 한다. 전역 server-registry
     * 로 띄우면 tool-router 의 전역 externalTools fallback(visibility=global 전용)에
     * 도구가 등록돼 **다른 사용자도 그 도구를 실행**할 수 있다(= 남의 자격증명으로
     * 접근하는 데이터가 유출).
     */
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

    /**
     * 부팅 시 자동 복원 — 프로세스 재시작 후 user MCP 풀은 비어 있다. 종전에는 복원 경로가
     * 없어 채팅 시작(onChatStart)·로그인 전까지 서버가 뜨지 않았고, 설정 화면이 계속
     * "연결 끊김"으로 보였다(enabled/auto_spawn 은 저장돼 있는데도).
     *
     * 먼저 직전 프로세스의 고아 instance 행을 stopped 로 마감한 뒤, enabled+auto_spawn
     * 서버를 가진 사용자별로 ensureUserServers 를 돌린다(멱등).
     *
     * MCP_RESTORE_ON_BOOT=false 로 끌 수 있다 — 사용자가 많아 부팅 시 자식 프로세스가
     * 과도해지는 환경을 위한 opt-out. 실패는 기동을 막지 않는다.
     */
    async restoreOnBoot(): Promise<void> {
        if (process.env.MCP_RESTORE_ON_BOOT === 'false') {
            logger.info('restoreOnBoot: MCP_RESTORE_ON_BOOT=false — 건너뜀');
            return;
        }
        try {
            const closed = await this.repo.closeOrphanInstances();
            if (closed > 0) logger.info(`restoreOnBoot: 고아 instance ${closed}건 stopped 로 마감`);

            const userIds = await this.repo.listAutoSpawnUserIds();
            if (userIds.length === 0) {
                logger.info('restoreOnBoot: 복원 대상 사용자 없음');
                return;
            }
            logger.info(`restoreOnBoot: 사용자 ${userIds.length}명 복원 시작`);
            // 사용자별 순차 — 동시에 몰면 부팅 직후 자식 프로세스가 한꺼번에 뜬다.
            for (const userId of userIds) {
                await this.ensureUserServers(userId, 'boot').catch(e =>
                    logger.warn(`restoreOnBoot 실패 u=${userId}: ${e instanceof Error ? e.message : String(e)}`));
            }
            logger.info('restoreOnBoot: 복원 완료');
        } catch (e) {
            logger.warn(`restoreOnBoot 실패(기동은 계속): ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async shutdownAll(): Promise<void> {
        logger.info(`shutdownAll: 전체 풀 정리 (size=${this.userPool.size()})`);
        // 풀만 닫으면 instance 행이 running 인 채로 남아 이력이 거짓이 된다 —
        // 다음 부팅의 closeOrphanInstances 가 보완하지만, graceful 종료에선 여기서 마감한다.
        await this.repo.closeOrphanInstances().catch(() => { /* 이력 실패는 종료를 막지 않는다 */ });
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

        const shellWrapped = server.command
            ? wrapEnvPlaceholdersAsShellRefs(server.command, Array.isArray(server.args) ? server.args : [])
            : { command: server.command, args: server.args, wrapped: false, keys: [] as string[] };
        if (shellWrapped.wrapped) {
            const missing = shellWrapped.keys.filter((k) => !(k in env));
            if (missing.length) logger.warn(`{{env.*}} 참조 키가 env 에 없음 (빈값으로 전개) s=${serverId}: ${missing.join(',')}`);
        }
        const config: ServerSpawnConfig = {
            id: server.id,
            user_id: userId,
            name: server.name,
            transport_type: server.transport_type,
            // {{env.KEY}} 자리표시자(위치 인자 secret)는 값을 argv 에 박지 않고 sh 변수 참조로 감싼다
            // (env-placeholder-shell — ps 노출 차단, 2026-09-03). 값은 env 로만 전달.
            command: shellWrapped.command,
            args: shellWrapped.args,
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

        // 연결 실패를 **영속화**한 뒤 rethrow — 실패한 client 는 풀에 등록되지 않으므로
        // 기록하지 않으면 목록 API 가 `connectionError: null` 을 돌려주고, 화면에는 원인
        // 없는 "연결 안 됨"만 남는다(승인은 됐는데 도구가 영영 0개인 상태를 알아챌 수 없다).
        try {
            await client.connect();
        } catch (e) {
            const classified = classifyConnectError(e);
            logger.warn(`connect 실패 u=${userId} s=${serverId} code=${classified.code}: ${classified.message}`);
            await this.repo
                .recordInstanceTransition(serverId, userId, 'crashed', undefined, serializeConnectError(classified))
                .catch(() => { /* 기록 실패가 원인 전파를 막지 않게 한다 */ });
            throw e;
        }
        this.userPool.add(userId, serverId, client);
        // pid 를 함께 남긴다 — 이게 없어서 운영 instance 행이 전부 pid NULL 이었고,
        // 헬스체크(verifyRunningInstancesByPid)가 항상 missingPid 만 반환해
        // 죽은 프로세스를 판별하지 못했다. 원격 transport 는 pid 가 없어 종전대로 null.
        const pid = client.getPid?.() ?? undefined;
        await this.repo.recordInstanceTransition(serverId, userId, 'running', pid).catch(() => { /* noop */ });
        logger.info(`spawn 완료 u=${userId} s=${serverId} pid=${pid ?? 'n/a'}`);
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
