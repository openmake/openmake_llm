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
 *  - env: config.env 만 주입(호스트 env 미상속 — #151 과 동일 원칙, 더 강력).
 *    값은 `-e KEY=값` 으로 인자에 넣지 않고 `-e KEY`(이름만) + docker 프로세스 env 로 전달한다.
 *    커맨드라인 인자는 같은 호스트의 모든 사용자가 `ps` 로 읽을 수 있어 API 키·세션 쿠키가
 *    평문 노출되기 때문(프로세스 env 는 소유자만 접근 가능).
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
    /**
     * sandboxed=true 일 때 docker 프로세스에 넘길 env — 컨테이너는 `-e KEY`(이름만) 로
     * 여기서 값을 상속받는다. env 값은 인자에 없으므로 `ps` 에 노출되지 않는다.
     * ⚠️ 예외: 서버 config 가 `{{env.KEY}}` 를 command/args 에 치환해 쓰면(lifecycle-supervisor
     * substituteEnvPlaceholders — 카탈로그 server-postgres 템플릿의 DATABASE_URL 위치 인자) 그 값은
     * `docker run` argv 에 실려 같은 호스트의 다른 로컬 계정이 볼 수 있다(2026-09-02 보안 리뷰 B5-01).
     * 위치 인자로만 비밀을 받는 서버에 한정된, 문서화된 트레이드오프.
     */
    env?: Record<string, string>;
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
    /**
     * 컨테이너 라벨(openmake.pid)에 새길 소유 프로세스 pid — 부팅 고아 스윕
     * (sandbox-bootstrap reapOrphanSandboxContainers)의 생존 판정 기준.
     */
    ownerPid: number;
}

/** MCP 샌드박스 컨테이너 식별 라벨 — ⚠️ task-sandbox(영속)·artifact-exec 와 절대 겹치면 안 됨 */
export const MCP_SANDBOX_ROLE_LABEL = 'openmake.role=mcp-sandbox';
export const MCP_SANDBOX_PID_LABEL_KEY = 'openmake.pid';

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
        ownerPid: process.pid,
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

/**
 * PURE: 컨테이너에 전달할 env 값 조립 (loopback 치환 적용).
 * buildDockerArgs 가 `-e KEY`(이름만) 를 넣으므로, 실제 값은 이 결과를 docker 프로세스의
 * spawn env 로 넘겨야 컨테이너까지 도달한다.
 */
export function buildSandboxedEnv(input: SandboxInput): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.env ?? {})) {
        out[k] = rewriteLoopback(String(v));
    }
    return out;
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
    // --memory-swap = --memory 로 swap 차단(미설정 시 swap 으로 메모리 상한 우회 가능).
    a.push('--pids-limit', String(cfg.pidsLimit), '--memory', cfg.memory, '--memory-swap', cfg.memory, '--cpus', cfg.cpus);
    a.push('--user', cfg.user);
    // 고아 식별 라벨 — 소유 프로세스가 죽은 컨테이너를 부팅 스윕이 결정적으로 판정한다
    // (실사례: SIGKILL 이 docker CLI 만 죽이고 stdin EOF 를 무시하는 서버가 컨테이너로 잔존).
    a.push('--label', MCP_SANDBOX_ROLE_LABEL);
    a.push('--label', `${MCP_SANDBOX_PID_LABEL_KEY}=${cfg.ownerPid}`);
    a.push('--label', `openmake.serverId=${sanitizeId(input.serverId)}`);
    if (cfg.readonly) a.push('--read-only', '--tmpfs', '/tmp:rw,exec', '--tmpfs', '/run:rw');
    a.push('-v', `${cacheVol}:/home/node/.cache`);
    if (referencesLoopback) a.push('--add-host', 'host.docker.internal:host-gateway');
    a.push('-w', '/home/node');
    a.push('-e', 'HOME=/home/node');
    a.push('-e', 'NPM_CONFIG_CACHE=/home/node/.cache/npm');
    a.push('-e', 'UV_CACHE_DIR=/home/node/.cache/uv');
    // uvx 는 도구 venv 를 UV_CACHE_DIR 이 아니라 ~/.local/share/uv/tools 에 만든다 —
    // readonly rootfs 에서 "Could not create temporary file (os error 30)" 로 전멸
    // (2026-09-01 운영 실측: uvx 서버 2종만 실패, npx 계열은 전부 생존). 캐시 볼륨으로
    // 재지정하면 readonly 호환 + 재spawn 시 도구 venv 재사용(설치 생략) 이득도 있다.
    a.push('-e', 'UV_TOOL_DIR=/home/node/.cache/uv-tools');
    // 서버 config.env 만 컨테이너에 주입 (호스트 env 미상속).
    // 🔒 값은 인자에 넣지 않는다 — `-e KEY`(이름만) 형태면 docker 가 호출 프로세스의 env 에서
    //    값을 읽어 컨테이너로 전달하므로, `ps` 로 읽히는 커맨드라인에 비밀이 남지 않는다.
    //    값 자체는 buildSandboxedEnv() 가 돌려주고 호출자가 spawn env 로 넘긴다.
    for (const k of Object.keys(input.env ?? {})) {
        a.push('-e', k);
    }
    a.push(cfg.image);
    a.push(rewriteLoopback(input.command), ...input.args.map((x) => rewriteLoopback(String(x))));
    return a;
}

/**
 * 외부 MCP stdio command 를 docker run 으로 감싼다. 게이트 미충족 시 원본 그대로(no-op).
 * sandboxed=true 이면 인자엔 `-e KEY`(이름만) 가 들어가므로, 호출자는 반환된 `env` 를
 * StdioClientTransport env 로 넘겨야 한다(값이 docker 프로세스를 거쳐 컨테이너에 전달됨).
 */
export function buildSandboxedCommand(input: SandboxInput, cfg: SandboxConfig = defaultSandboxConfig()): SandboxResult {
    // per-server opt-out — 호스트 설치 바이너리 의존 등으로 컨테이너 미동작인 신뢰 서버는
    // sandbox_network='host' 로 비격리 호스트 실행 (플래그 ON 여부와 무관).
    if (input.network === 'host') return { command: input.command, args: input.args, sandboxed: false };
    if (!cfg.enabled) return { command: input.command, args: input.args, sandboxed: false };
    if (!cfg.dockerPath) {
        // fail-closed: 샌드박스가 명시적으로 활성(cfg.enabled)인데 docker 가 없으면 비격리로 조용히
        // 실행하지 않고 spawn 을 거부한다. 격리를 요구한 서버를 unsandboxed 로 돌리는 fail-open 은
        // "격리했다"는 오인을 준다. host 네트워크 opt-out(신뢰 서버)은 위에서 이미 통과했고,
        // 비격리가 필요하면 MCP_SANDBOX_ENABLED=false 또는 서버별 sandbox_network='host' 로 명시한다.
        // (throw 는 external-client.connect 의 catch 에서 연결 error 로 처리 — 서버 크래시 아님)
        throw new Error('MCP 샌드박스가 활성화(MCP_SANDBOX_ENABLED)됐으나 docker 바이너리를 찾을 수 없습니다. 비격리 실행을 거부합니다 — Docker 설치/실행을 확인하거나 sandbox_network=host 로 opt-out 하세요.');
    }
    const dockerArgs = buildDockerArgs(input, cfg);
    return { command: cfg.dockerPath, args: dockerArgs, sandboxed: true, env: buildSandboxedEnv(input) };
}
