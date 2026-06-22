/**
 * ============================================================
 * MCP Sandbox (Docker) — 외부 MCP stdio 서버 컨테이너 격리
 * ============================================================
 *
 * 외부(import·승인) MCP 서버를 호스트 자식 프로세스로 직접 spawn 하던 것을,
 * `docker run` 으로 감싸 컨테이너(Linux)로 격리한다. bubblewrap 과 달리
 * **macOS(Docker Desktop) 포함 docker 가 있는 모든 호스트에서 실제 격리**가 동작한다.
 * 단일 후킹: external-client createTransport 가 command/args 를 이 함수로 감싼다.
 *
 * 격리(컨테이너 기본):
 *  - 파일시스템: 호스트 경로 미마운트 → 호스트 FS·비밀 접근 불가(컨테이너 기본 격리).
 *  - env: config.env 만 `-e` 로 주입(호스트 env 미상속 — #151 과 동일 원칙, 더 강력).
 *  - 네트워크: full(bridge) | none(--unshare 대신 --network none). 서버별 정책.
 *  - 권한: --cap-drop ALL + no-new-privileges + 비-root user + pids/memory 상한(cgroups).
 *  - 내부 loopback(127.0.0.1/localhost) → host.docker.internal 자동 치환
 *    (컨테이너의 127.0.0.1 은 호스트가 아니므로 DB 등 내부 서비스 접속 인자 보정).
 *
 * 안전/호환:
 *  - 게이트 미충족(flag off / docker 부재) → 원본 그대로 no-op + 경고(graceful).
 *  - 런타임 이미지(node+uv)는 사전 빌드 필요: infra/mcp-runtime/Dockerfile.
 *
 * @module mcp/sandbox-docker
 */
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('McpSandbox');

/** 'full'=bridge, 'none'=--network none, 'host'=컨테이너 없이 호스트 직접 실행(opt-out) */
export type SandboxNetwork = 'full' | 'none' | 'host';

export interface SandboxInput {
    command: string;
    args: string[];
    serverId: string;
    network?: SandboxNetwork;
    /** 컨테이너에 -e 로 주입할 env (서버 config.env). 호스트 env 는 상속하지 않는다. */
    env?: Record<string, string>;
}

export interface SandboxResult {
    command: string;
    args: string[];
    /** 실제 docker 로 감쌌는지 (false = no-op 통과) */
    sandboxed: boolean;
}

/** 게이트/프로파일 입력 — 테스트 주입 가능(순수성). */
export interface SandboxConfig {
    enabled: boolean;
    /** resolve 된 docker 절대경로 또는 null(미발견) */
    dockerPath: string | null;
    image: string;
    /** per-server 캐시 볼륨 prefix — 실제 볼륨은 `${cacheVolume}-${serverId}` (상호 오염 차단) */
    cacheVolume: string;
    memory: string;
    pidsLimit: number;
    /** CPU 상한 (CPU DoS 방어) */
    cpus: string;
    user: string;
    /** read-only rootfs + tmpfs (opt-in — 일부 서버가 home 외 쓰기 시 깨질 수 있어 기본 off) */
    readonly: boolean;
}

let dockerCache: { key: string; value: string | null } | null = null;
/** PATH 또는 절대경로에서 docker 바이너리 탐색 (memoize). 아티팩트 실행 서비스도 재사용. */
export function resolveDocker(dockerPath: string): string | null {
    if (dockerCache && dockerCache.key === dockerPath) return dockerCache.value;
    let resolved: string | null = null;
    try {
        if (dockerPath.includes('/')) {
            resolved = fs.existsSync(dockerPath) ? dockerPath : null;
        } else {
            const dirs = (process.env.PATH || '').split(path.delimiter);
            // Docker Desktop(macOS) 기본 경로 보강
            const extra = ['/usr/local/bin', '/opt/homebrew/bin'];
            for (const dir of [...dirs, ...extra]) {
                if (!dir) continue;
                const candidate = path.join(dir, dockerPath);
                if (fs.existsSync(candidate)) { resolved = candidate; break; }
            }
        }
    } catch {
        resolved = null;
    }
    dockerCache = { key: dockerPath, value: resolved };
    return resolved;
}

/** 환경에서 SandboxConfig 조립 (No-Hardcoding — env override). */
export function defaultSandboxConfig(): SandboxConfig {
    const enabled = process.env.MCP_SANDBOX_ENABLED === 'true';
    const dockerPath = enabled ? resolveDocker(process.env.MCP_SANDBOX_DOCKER_PATH || 'docker') : null;
    return {
        enabled,
        dockerPath,
        image: process.env.MCP_SANDBOX_IMAGE || 'openmake-mcp-runtime:latest',
        cacheVolume: process.env.MCP_SANDBOX_CACHE_VOLUME || 'openmake-mcp-cache',
        memory: process.env.MCP_SANDBOX_MEMORY || '512m',
        pidsLimit: Number(process.env.MCP_SANDBOX_PIDS_LIMIT) || 256,
        cpus: process.env.MCP_SANDBOX_CPUS || '1.0',
        user: process.env.MCP_SANDBOX_USER || '1000:1000',
        readonly: process.env.MCP_SANDBOX_READONLY === 'true',
    };
}

/** docker 볼륨/식별자 안전화. */
function sanitizeId(id: string): string {
    return id.replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
}

/** 컨테이너 내 127.0.0.1/localhost → host.docker.internal (내부 서비스 접속 보정). */
const LOOPBACK_RE = /\b(?:127\.0\.0\.1|localhost)\b/g;
/** loopback 참조 여부 검사용 (non-global — .test() 상태 누적 방지). */
const LOOPBACK_TEST = /(?:127\.0\.0\.1|localhost)/;
export function rewriteLoopback(s: string): string {
    return s.replace(LOOPBACK_RE, 'host.docker.internal');
}

/** PURE: docker run 인자 조립 (유닛테스트 대상). */
export function buildDockerArgs(input: SandboxInput, cfg: SandboxConfig): string[] {
    const net = (input.network ?? 'full') === 'none' ? 'none' : 'bridge';
    // per-server 캐시 볼륨 — 컨테이너 간 캐시(공급망) 상호 오염 차단.
    const cacheVol = `${cfg.cacheVolume}-${sanitizeId(input.serverId)}`;
    // 내부 서비스(127.0.0.1/localhost) 를 참조하는 서버에만 host.docker.internal 부여 —
    // 그 외 서버가 호스트 내부 서비스에 도달하는 over-grant 차단.
    const referencesLoopback = LOOPBACK_TEST.test(
        [input.command, ...input.args.map(String), ...Object.values(input.env ?? {}).map(String)].join(' '),
    );
    const a: string[] = ['run', '--rm', '-i', '--init'];
    a.push('--network', net);
    a.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges');
    a.push('--pids-limit', String(cfg.pidsLimit), '--memory', cfg.memory, '--cpus', cfg.cpus);
    a.push('--user', cfg.user);
    if (cfg.readonly) a.push('--read-only', '--tmpfs', '/tmp:rw,exec', '--tmpfs', '/run:rw');
    a.push('-v', `${cacheVol}:/home/node/.cache`);
    if (referencesLoopback) a.push('--add-host', 'host.docker.internal:host-gateway');
    a.push('-w', '/home/node');
    a.push('-e', 'HOME=/home/node');
    a.push('-e', 'NPM_CONFIG_CACHE=/home/node/.cache/npm');
    a.push('-e', 'UV_CACHE_DIR=/home/node/.cache/uv');
    // 서버 config.env 만 컨테이너에 주입 (호스트 env 미상속)
    for (const [k, v] of Object.entries(input.env ?? {})) {
        a.push('-e', `${k}=${rewriteLoopback(String(v))}`);
    }
    a.push(cfg.image);
    a.push(rewriteLoopback(input.command), ...input.args.map((x) => rewriteLoopback(String(x))));
    return a;
}

const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(msg);
}

/**
 * 외부 MCP stdio command 를 docker run 으로 감싼다. 게이트 미충족 시 원본 그대로(no-op).
 * sandboxed=true 이면 env 는 args(-e)에 baked 되므로 호출자는 StdioClientTransport env 를 비워야 한다.
 */
export function buildSandboxedCommand(input: SandboxInput, cfg: SandboxConfig = defaultSandboxConfig()): SandboxResult {
    // per-server opt-out — 호스트 설치 바이너리 의존 등으로 컨테이너 미동작인 신뢰 서버는
    // sandbox_network='host' 로 비격리 호스트 실행 (플래그 ON 여부와 무관).
    if (input.network === 'host') return { command: input.command, args: input.args, sandboxed: false };
    if (!cfg.enabled) return { command: input.command, args: input.args, sandboxed: false };
    if (!cfg.dockerPath) {
        warnOnce('docker', 'docker 바이너리를 찾지 못해 MCP 샌드박스 미적용(비격리 실행). Docker 설치/실행 확인 필요.');
        return { command: input.command, args: input.args, sandboxed: false };
    }
    const dockerArgs = buildDockerArgs(input, cfg);
    return { command: cfg.dockerPath, args: dockerArgs, sandboxed: true };
}
