/**
 * ============================================================
 * Egress Proxy 수명주기 — 브라우저 네트워크 레벨 도메인 allowlist (Manus 하드닝)
 * ============================================================
 *
 * 브라우저 전용 task 컨테이너를 internal Docker 네트워크(인터넷 차단)에만 연결하고, 양쪽
 * (internal + bridge)에 붙은 egress 프록시를 통해서만 allowlist 도메인에 도달하게 한다.
 * ensureEgressProxy 가 internal 네트워크 + 프록시 컨테이너를 멱등 생성한다.
 *
 * @module services/task-sandbox/egress-proxy
 */
import { spawn } from 'child_process';
import type { TaskSandboxConfig } from '../../config/task-sandbox';
import { createLogger } from '../../utils/logger';

const logger = createLogger('EgressProxy');

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

/** 새로 띄운 프록시가 listen 할 때까지 기다린다 — 시간을 넘기면 오류(fail-closed, 첫 연결 ECONNREFUSED 대신). */
async function waitProxyReady(cfg: TaskSandboxConfig): Promise<void> {
    const deadline = Date.now() + cfg.egressReadyTimeoutMs;
    for (;;) {
        const logs = await run(cfg.dockerPath, ['logs', '--tail', '50', cfg.egressProxyContainer]);
        if (isProxyListening(`${logs.stdout}\n${logs.stderr}`, cfg.egressProxyPort)) return;
        if (Date.now() >= deadline) throw new Error(`egress 프록시가 준비되지 않았습니다(${cfg.egressReadyTimeoutMs}ms)`);
        await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
}

/** internal 네트워크 + 프록시 컨테이너를 보장하고 프록시 base URL 을 반환. 멱등. */
export async function ensureEgressProxy(cfg: TaskSandboxConfig): Promise<string> {
    const d = cfg.dockerPath;
    // 1) internal 네트워크 (외부 연결 없음) — 없으면 생성.
    const netExists = await run(d, ['network', 'inspect', cfg.egressNetwork]);
    if (netExists.code !== 0) {
        const c = await run(d, ['network', 'create', '--internal', cfg.egressNetwork]);
        if (c.code !== 0 && !/already exists/i.test(c.stderr)) {
            throw new Error(`egress internal 네트워크 생성 실패: ${c.stderr}`);
        }
        logger.info(`internal 네트워크 생성: ${cfg.egressNetwork}`);
    }

    // 2) 프록시 컨테이너 — 실행 중이면 재사용, 아니면 생성.
    const running = await run(d, ['inspect', '-f', '{{.State.Running}}', cfg.egressProxyContainer]);
    if (running.stdout !== 'true') {
        await run(d, ['rm', '-f', cfg.egressProxyContainer]); // 잔존 제거
        const create = await run(d, buildEgressProxyRunArgs(cfg));
        if (create.code !== 0) throw new Error(`egress 프록시 컨테이너 생성 실패: ${create.stderr}`);
        // 프록시는 bridge 에도 연결 — 외부(allowlist 도메인) 도달용.
        const connect = await run(d, ['network', 'connect', 'bridge', cfg.egressProxyContainer]);
        if (connect.code !== 0 && !/already exists|endpoint/i.test(connect.stderr)) {
            logger.warn(`egress 프록시 bridge 연결 경고: ${connect.stderr}`);
        }
        // 새로 띄운 경우에만 준비를 기다린다 — 이미 떠 있던 프록시는 종전대로 바로 쓴다(2026-11-08 점검).
        await waitProxyReady(cfg);
        logger.info(`egress 프록시 기동 (${cfg.egressProxyContainer}, allowlist=${cfg.egressAllowlist.length}개${isPublicMode(cfg) ? ', mode=public' : ''})`);
    }
    return `http://${cfg.egressProxyContainer}:${cfg.egressProxyPort}`;
}

