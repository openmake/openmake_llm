/**
 * Tool Runtime 부팅 — 외부 MCP 서버 연결·샌드박스 점검·사용자 MCP 풀 supervisor (2026-09-19).
 *
 * MCP 런타임은 Base 다(config/addon-boundary.ts). 다만 기동 절차를 `server.ts` 가 직접 조립하지 않도록 여기 한 곳에 둔다 —
 * supervisor 조립이 listen 콜백과 직접 실행 블록에 두 벌 있어, 가드 없는 쪽이 복구를 시작한 supervisor 를 덮어쓸 수 있었다.
 *
 * @module mcp/runtime-boot
 */
import { createLogger } from '../../utils/logger';

const logger = createLogger('ToolRuntime');

/** 외부 MCP 서버 초기화(DB 설정 로드 → 연결) + 샌드박스 자세 관측·고아 컨테이너 정리. 실패는 호출부가 fail-open 으로 다룬다. */
export async function startToolRuntime(): Promise<void> {
    const { getUnifiedMCPClient } = await import('./index');
    const { getUnifiedDatabase } = await import('../../data/models/unified-database');
    await getUnifiedMCPClient().initializeExternalServers(getUnifiedDatabase());
    logger.info('외부 MCP 서버 초기화 완료');
    // 샌드박스 자세 관측(1회) — OFF+docker 가용(격리 권장) / ON+docker 부재(fail-closed 조기 경보)
    const { sandboxBootAdvisory, reapOrphanSandboxContainers } = await import('./sandbox-bootstrap');
    const advisory = sandboxBootAdvisory();
    if (advisory) logger.warn(advisory);
    // 소유 프로세스가 죽은 MCP 샌드박스 컨테이너 정리 (라벨 pid 기준, fail-open)
    const reap = reapOrphanSandboxContainers();
    if (reap.reaped > 0 || reap.errors.length > 0) {
        logger.warn(`MCP 샌드박스 고아 스윕: 검사 ${reap.scanned}, 정리 ${reap.reaped}, 보류 ${reap.skipped}, 오류 ${reap.errors.length}`);
    }
}

/**
 * 사용자별 MCP 프로세스 풀 supervisor — listen 완료 후 1회. 이미 있으면 아무것도 하지 않는다(멱등).
 * 실패해도 서버는 계속 뜬다(graceful skip) — 알아채는 방법은 이 오류 로그와 user MCP 도구 부재.
 */
export async function startMcpLifecycleSupervisor(): Promise<void> {
    try {
        const [
            { MCPLifecycleSupervisor, setLifecycleSupervisor, getLifecycleSupervisor },
            { getUserMCPPool },
            { McpCatalogRepository },
            { ExternalMCPClient },
            { getUnifiedDatabase },
        ] = await Promise.all([
            import('./lifecycle-supervisor'),
            import('./user-pool'),
            import('../../data/repositories/mcp-catalog-repository'),
            import('./external-client'),
            import('../../data/models/unified-database'),
        ]);
        if (getLifecycleSupervisor()) return;  // 중복 초기화 방지
        const supervisor = new MCPLifecycleSupervisor({
            userPool: getUserMCPPool(),
            repo: new McpCatalogRepository(getUnifiedDatabase().getPool()),
            clientFactory: (config) => new ExternalMCPClient({
                id: config.id,
                name: config.name ?? config.id,
                transport_type: config.transport_type,
                command: config.command ?? undefined,
                args: config.args as string[] | undefined,
                env: config.env ?? undefined,
                url: config.url ?? undefined,
                enabled: true,
                created_at: '',
                updated_at: '',
                catalog_template_id: config.catalog_template_id ?? undefined,
                sandbox_network: config.sandbox_network ?? 'full',
                tool_allowlist: config.tool_allowlist,
                user_id: config.user_id,
            }),
        });
        setLifecycleSupervisor(supervisor);
        logger.info('MCP Lifecycle Supervisor 초기화 완료');
        // 재시작 후 user MCP 풀은 비어 있다 — enabled+auto_spawn 서버를 다시 띄운다.
        // 기동을 막지 않도록 await 하지 않는다(자식 프로세스 spawn 이 수 초 걸린다).
        void supervisor.restoreOnBoot();
    } catch (err) {
        logger.error('MCP Lifecycle Supervisor 초기화 실패 (graceful skip):', err);
    }
}
