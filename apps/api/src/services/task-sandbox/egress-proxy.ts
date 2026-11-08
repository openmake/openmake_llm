/**
 * ============================================================
 * Egress Proxy 수명주기 — 브라우저 네트워크 레벨 도메인 allowlist (Manus 하드닝)
 * ============================================================
 *
 * 브라우저 전용 task 컨테이너를 internal Docker 네트워크(인터넷 차단)에만 연결하고, 양쪽
 * (internal + bridge)에 붙은 egress 프록시를 통해서만 allowlist 도메인에 도달하게 한다.
 * ensureEgressProxy 가 internal 네트워크 + 프록시 컨테이너를 멱등 생성한다.
 * internal 망은 gateway isolated 로 만들고 기존 망은 비어 있을 때 옮긴다(egress 내부망 gateway 격리, 2026-11-08 점검 후속).
 *
 * @module services/task-sandbox/egress-proxy
 */
import { spawn } from 'child_process';
import type { TaskSandboxConfig } from '../../config/task-sandbox';
import { createLogger } from '../../utils/logger';

const logger = createLogger('EgressProxy');

/** docker CLI 실행 함수 모양 — 테스트가 가짜를 넣을 수 있게 내보낸다. */
export type DockerRun = (docker: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

function run(docker: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn(docker, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', (b) => { stdout += b.toString('utf8', 0, 8192); });
        child.stderr.on('data', (b) => { stderr += b.toString('utf8', 0, 8192); });
        child.on('close', (code) => resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() }));
        child.on('error', (e) => resolve({ code: -1, stdout: '', stderr: String(e) }));
    });
}

/** 허용 목록이 비었고 public 모드를 쓰는가 — 프록시가 도메인 제한 없이 사설망·메타데이터·포트만 막는다. */
function isPublicMode(cfg: TaskSandboxConfig): boolean {
    return cfg.egressAllowlist.length === 0 && cfg.egressPublicWhenEmpty;
}

/** PURE: 프록시 컨테이너 실행 인자 — internal 망, 권한 축소, 허용 도메인·허용 포트(목록이 비면 public 모드 선택). */
export function buildEgressProxyRunArgs(cfg: TaskSandboxConfig): string[] {
    return [
        'run', '-d', '--name', cfg.egressProxyContainer,
        '--network', cfg.egressNetwork,
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
        '-e', `EGRESS_ALLOWLIST=${cfg.egressAllowlist.join(',')}`,
        ...(isPublicMode(cfg) ? ['-e', 'EGRESS_ALLOWLIST_MODE=public'] : []),
        '-e', `EGRESS_ALLOWED_PORTS=${cfg.egressAllowedPorts.join(',')}`,
        '-e', `EGRESS_PROXY_PORT=${cfg.egressProxyPort}`,
        cfg.egressProxyImage,
    ];
}

/** PURE: 프록시 기동 로그에 해당 포트의 listening 줄이 있는가(infra/egress-proxy/proxy.mjs 의 기동 로그). */
export function isProxyListening(logs: string, port: number): boolean {
    return new RegExp(`listening :${port}(?!\\d)`).test(logs);
}

const READY_POLL_MS = 250;

/**
 * 프록시가 listen 할 때까지 기다린다 — 시간을 넘기면 오류(fail-closed, 첫 연결 ECONNREFUSED 대신).
 * 컨테이너가 실행 중이 아니면 시간 초과까지 기다리지 않고 바로 실패한다.
 * 기동 후 준비 시간을 이미 넘긴 컨테이너는 준비된 것으로 본다 — 오래 떠 있던 프록시는 로그가 밀려
 * listening 줄이 없을 수 있다. 기동 시각을 읽지 못하면 방금 기동한 것으로 본다(fail-closed).
 */
async function waitProxyReady(cfg: TaskSandboxConfig, exec: DockerRun): Promise<void> {
    const deadline = Date.now() + cfg.egressReadyTimeoutMs;
    for (let first = true; ; first = false) {
        const logs = await exec(cfg.dockerPath, ['logs', '--tail', '50', cfg.egressProxyContainer]);
        if (isProxyListening(`${logs.stdout}\n${logs.stderr}`, cfg.egressProxyPort)) return;
        const state = await exec(cfg.dockerPath, ['inspect', '-f', '{{.State.Running}} {{.State.StartedAt}}', cfg.egressProxyContainer]);
        const [runningTok, startedTok = ''] = state.stdout.split(' ');
        if (runningTok !== 'true') throw new Error('egress 프록시 컨테이너가 실행 중이 아닙니다');
        // 진입 시 한 번만 — 매 반복 검사하면 새 컨테이너도 준비 시간이 지나는 순간 통과해 버린다.
        // docker 의 StartedAt 은 소수점 아래 9자리라 3자리로 잘라 읽는다.
        const startedMs = Date.parse(startedTok.replace(/(\.\d{3})\d+/, '$1'));
        if (first && Date.now() - startedMs >= cfg.egressReadyTimeoutMs) return;
        if (Date.now() >= deadline) throw new Error(`egress 프록시가 준비되지 않았습니다(${cfg.egressReadyTimeoutMs}ms)`);
        await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
}

/** Docker bridge 드라이버의 IPv4 gateway 모드 옵션 키(Docker Engine 28.0.0+, `--internal` 망의 isolated). */
export const EGRESS_GATEWAY_MODE_OPT = 'com.docker.network.bridge.gateway_mode_ipv4';
const GATEWAY_MODE_MIN_MAJOR = 28;
const GATEWAY_UNSUPPORTED_WARN = 'egress 내부망 gateway isolated 미지원 데몬(Docker 28 미만) — 종전 internal 망으로 생성';

/** PURE: internal 망 생성 인자 — 격리면 gateway isolated 옵션을 붙인다. */
export function isolatedNetworkCreateArgs(cfg: TaskSandboxConfig, isolated: boolean): string[] {
    return ['network', 'create', '--internal', ...(isolated ? ['-o', `${EGRESS_GATEWAY_MODE_OPT}=isolated`] : []), cfg.egressNetwork];
}

/** PURE: `network inspect -f '{{index .Options "<OPT>"}}'` 출력이 isolated 인가. */
export function isGatewayIsolated(inspectStdout: string): boolean {
    return inspectStdout.trim() === 'isolated';
}

/**
 * PURE: 서버 버전 문자열로 gateway 모드 지원 여부 — 28 이상 true, 미만 false, 읽지 못하면 null.
 * 28 미만 bridge 드라이버는 모르는 -o 옵션을 오류 없이 저장만 하므로 생성 결과로는 미지원을 알 수 없다.
 */
export function daemonSupportsGatewayMode(serverVersion: string): boolean | null {
    const m = /^(\d+)\./.exec(serverVersion.trim());
    return m ? Number(m[1]) >= GATEWAY_MODE_MIN_MAJOR : null;
}

function gatewayModeInspectArgs(cfg: TaskSandboxConfig): string[] {
    return ['network', 'inspect', '-f', `{{index .Options "${EGRESS_GATEWAY_MODE_OPT}"}}`, cfg.egressNetwork];
}

async function gatewaySupported(cfg: TaskSandboxConfig, exec: DockerRun): Promise<boolean | null> {
    const v = await exec(cfg.dockerPath, ['version', '-f', '{{.Server.Version}}']);
    return v.code === 0 ? daemonSupportsGatewayMode(v.stdout) : null;
}

/** internal 망 생성 — 격리 옵션을 거부하면 옵션 없이 1회 재시도, 그것도 실패하면 오류. */
async function createInternalNetwork(cfg: TaskSandboxConfig, exec: DockerRun): Promise<void> {
    const d = cfg.dockerPath;
    let isolated = cfg.egressGatewayIsolated;
    if (isolated && (await gatewaySupported(cfg, exec)) === false) {
        logger.warn(GATEWAY_UNSUPPORTED_WARN);
        isolated = false;
    }
    let c = await exec(d, isolatedNetworkCreateArgs(cfg, isolated));
    if (c.code !== 0 && /already exists/i.test(c.stderr)) return;
    if (c.code !== 0 && isolated) {
        logger.warn(GATEWAY_UNSUPPORTED_WARN);
        isolated = false;
        c = await exec(d, isolatedNetworkCreateArgs(cfg, false));
        if (c.code !== 0 && /already exists/i.test(c.stderr)) return;
    }
    if (c.code !== 0) throw new Error(`egress internal 네트워크 생성 실패: ${c.stderr}`);
    logger.info(`internal 네트워크 생성: ${cfg.egressNetwork}${isolated ? ' (gateway isolated)' : ''}`);
    if (isolated && !isGatewayIsolated((await exec(d, gatewayModeInspectArgs(cfg))).stdout)) logger.warn(GATEWAY_UNSUPPORTED_WARN);
}

/**
 * 기존(격리 아님) 망을 gateway isolated 로 옮긴다 — 프록시 말고 붙은 컨테이너가 없을 때만.
 * 쓰는 컨테이너가 있거나 망을 지우지 못하면 기존 망으로 계속하고 다음 기동 때 다시 시도한다.
 */
async function migrateToIsolated(cfg: TaskSandboxConfig, exec: DockerRun): Promise<void> {
    const d = cfg.dockerPath;
    if ((await gatewaySupported(cfg, exec)) === false) return;
    const members = await exec(d, ['network', 'inspect', '-f', '{{range .Containers}}{{.Name}} {{end}}', cfg.egressNetwork]);
    if (members.code !== 0) {
        logger.warn('egress 내부망 gateway 격리 이행 보류(연결 컨테이너 inspect 실패) — 다음 기동 때 재시도');
        return;
    }
    const others = members.stdout.split(/\s+/).filter((n) => n && n !== cfg.egressProxyContainer);
    if (others.length > 0) {
        logger.warn('egress 내부망 gateway 격리 이행 보류(사용 중인 컨테이너 있음) — 다음 기동 때 재시도');
        return;
    }
    await exec(d, ['rm', '-f', cfg.egressProxyContainer]);
    const r = await exec(d, ['network', 'rm', cfg.egressNetwork]);
    if (r.code !== 0) {
        logger.warn('egress 내부망 gateway 격리 이행 보류(사용 중인 컨테이너 있음) — 다음 기동 때 재시도');
        return;
    }
    logger.info(`egress 내부망 gateway 격리 이행: ${cfg.egressNetwork}`);
    await createInternalNetwork(cfg, exec);
}

/** internal 네트워크 + 프록시 컨테이너를 보장하고 프록시 base URL 을 반환. 멱등. */
export async function ensureEgressProxy(cfg: TaskSandboxConfig, exec: DockerRun = run): Promise<string> {
    const d = cfg.dockerPath;
    // 1) internal 네트워크 (외부 연결 없음) — 없으면 생성, 있는데 gateway 격리가 아니면 이행.
    const net = await exec(d, gatewayModeInspectArgs(cfg));
    if (net.code !== 0) {
        await createInternalNetwork(cfg, exec);
    } else if (cfg.egressGatewayIsolated && !isGatewayIsolated(net.stdout)) {
        await migrateToIsolated(cfg, exec);
    }

    // 2) 프록시 컨테이너 — 실행 중이면 재사용, 아니면 생성.
    const running = await exec(d, ['inspect', '-f', '{{.State.Running}}', cfg.egressProxyContainer]);
    if (running.stdout !== 'true') {
        await exec(d, ['rm', '-f', cfg.egressProxyContainer]); // 잔존 제거
        const create = await exec(d, buildEgressProxyRunArgs(cfg));
        if (create.code !== 0) throw new Error(`egress 프록시 컨테이너 생성 실패: ${create.stderr}`);
        // 프록시는 bridge 에도 연결 — 외부(allowlist 도메인) 도달용.
        const connect = await exec(d, ['network', 'connect', 'bridge', cfg.egressProxyContainer]);
        if (connect.code !== 0 && !/already exists|endpoint/i.test(connect.stderr)) {
            logger.warn(`egress 프록시 bridge 연결 경고: ${connect.stderr}`);
        }
        logger.info(`egress 프록시 기동 (${cfg.egressProxyContainer}, allowlist=${cfg.egressAllowlist.length}개${isPublicMode(cfg) ? ', mode=public' : ''})`);
    }
    // 이미 떠 있던 프록시도 listen 을 확인한다 — 다른 경로가 방금 띄워 아직 listen 전일 수 있다(2026-11-08 점검).
    await waitProxyReady(cfg, exec);
    return `http://${cfg.egressProxyContainer}:${cfg.egressProxyPort}`;
}

