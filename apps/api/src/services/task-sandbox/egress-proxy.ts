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
        const create = await run(d, [
            'run', '-d', '--name', cfg.egressProxyContainer,
            '--network', cfg.egressNetwork,
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
            '-e', `EGRESS_ALLOWLIST=${cfg.egressAllowlist.join(',')}`,
            '-e', `EGRESS_PROXY_PORT=${cfg.egressProxyPort}`,
            cfg.egressProxyImage,
        ]);
        if (create.code !== 0) throw new Error(`egress 프록시 컨테이너 생성 실패: ${create.stderr}`);
        // 프록시는 bridge 에도 연결 — 외부(allowlist 도메인) 도달용.
        const connect = await run(d, ['network', 'connect', 'bridge', cfg.egressProxyContainer]);
        if (connect.code !== 0 && !/already exists|endpoint/i.test(connect.stderr)) {
            logger.warn(`egress 프록시 bridge 연결 경고: ${connect.stderr}`);
        }
        logger.info(`egress 프록시 기동 (${cfg.egressProxyContainer}, allowlist=${cfg.egressAllowlist.length}개)`);
    }
    return `http://${cfg.egressProxyContainer}:${cfg.egressProxyPort}`;
}

/** 프록시/네트워크 정리(운영 도구·테스트용). */
export async function teardownEgressProxy(cfg: TaskSandboxConfig): Promise<void> {
    const d = cfg.dockerPath;
    await run(d, ['rm', '-f', cfg.egressProxyContainer]);
    await run(d, ['network', 'rm', cfg.egressNetwork]);
}
