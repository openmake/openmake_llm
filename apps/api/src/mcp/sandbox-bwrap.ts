/**
 * ============================================================
 * MCP Sandbox (bubblewrap) — 외부 MCP stdio 서버 OS 격리
 * ============================================================
 *
 * 외부(import·승인) MCP 서버를 호스트 자식 프로세스로 직접 spawn 하던 것을,
 * bubblewrap(bwrap)으로 감싸 파일시스템·프로세스·(선택)네트워크를 격리한다.
 * Docker 미사용 — 정책(인프라 한정) 회피. 단일 후킹: external-client createTransport.
 *
 * 안전/호환 원칙:
 * - 게이트 미충족(플래그 off / 비-Linux / bwrap 부재) → 원본 command 그대로(no-op).
 *   기능 OFF 기본이라 머지해도 동작 무변화. graceful (채팅·MCP 흐름 무중단).
 * - 네트워크는 bwrap 한계상 binary: full(공유) | none(--unshare-net). 서버별 설정.
 *   "외부 허용 + 내부 loopback 차단" 미세화는 Phase 2(netns+nftables) — 본 모듈 범위 밖.
 *
 * @module mcp/sandbox-bwrap
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('McpSandbox');

export type SandboxNetwork = 'full' | 'none';

export interface SandboxInput {
    /** 원본 실행 명령 (예: 'npx') */
    command: string;
    /** 원본 인자 */
    args: string[];
    /** 서버 ID — per-server 작업 디렉토리 격리에 사용 */
    serverId: string;
    /** 네트워크 정책 (기본 'full') */
    network?: SandboxNetwork;
}

export interface SandboxResult {
    command: string;
    args: string[];
    /** 실제 bwrap 으로 감쌌는지 (false = no-op 통과) */
    sandboxed: boolean;
}

/** 게이트/프로파일 입력 — 테스트에서 주입 가능(순수성 확보) */
export interface SandboxConfig {
    enabled: boolean;
    platform: string;
    /** resolve 된 bwrap 절대경로 또는 null(미발견) */
    bwrapPath: string | null;
    /** per-server 작업 디렉토리 루트 */
    sandboxRoot: string;
    /** npx/uvx 패키지 캐시 (쓰기 바인드) */
    npmCache: string;
    /** 읽기전용 바인드 경로 목록 (시스템 + 툴체인) */
    roBinds: string[];
}

/** 기본 읽기전용 바인드 — 런타임(node/python)·CA·DNS 동작에 필요한 최소 시스템 경로. */
const DEFAULT_RO_BINDS = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/opt'];

function sanitizeId(id: string): string {
    return id.replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
}

/** PATH 또는 절대경로에서 bwrap 바이너리 탐색 (memoize). 미발견 시 null. */
let bwrapCache: { key: string; value: string | null } | null = null;
function resolveBwrap(bwrapPath: string): string | null {
    if (bwrapCache && bwrapCache.key === bwrapPath) return bwrapCache.value;
    let resolved: string | null = null;
    try {
        if (bwrapPath.includes('/')) {
            resolved = fs.existsSync(bwrapPath) ? bwrapPath : null;
        } else {
            for (const dir of (process.env.PATH || '').split(path.delimiter)) {
                if (!dir) continue;
                const candidate = path.join(dir, bwrapPath);
                if (fs.existsSync(candidate)) { resolved = candidate; break; }
            }
        }
    } catch {
        resolved = null;
    }
    bwrapCache = { key: bwrapPath, value: resolved };
    return resolved;
}

/** 환경/플랫폼에서 SandboxConfig 조립 (No-Hardcoding — env override). */
export function defaultSandboxConfig(): SandboxConfig {
    const enabled = process.env.MCP_SANDBOX_ENABLED === 'true';
    const platform = process.platform;
    const bwrapPath = enabled && platform === 'linux'
        ? resolveBwrap(process.env.MCP_SANDBOX_BWRAP_PATH || 'bwrap')
        : null;
    const home = os.homedir();
    const sandboxRoot = process.env.MCP_SANDBOX_ROOT || path.join(home, '.openmake-mcp-sandbox');
    const npmCache = process.env.MCP_SANDBOX_NPM_CACHE || path.join(home, '.npm');
    const extra = (process.env.MCP_SANDBOX_EXTRA_BINDS || '')
        .split(path.delimiter).map((s) => s.trim()).filter(Boolean);
    // 툴체인이 $HOME 하위(mise/nvm/uv)일 수 있어 ro 로 best-effort 바인드(존재 시).
    const toolchain = [path.join(home, '.local'), path.join(home, '.nvm'), path.join(home, '.cache', 'uv')];
    return {
        enabled, platform, bwrapPath, sandboxRoot, npmCache,
        roBinds: [...DEFAULT_RO_BINDS, ...toolchain, ...extra],
    };
}

/**
 * PURE: bwrap 인자 조립 (유닛테스트 대상). workdir 존재는 호출자가 보장.
 * 레포·비밀 경로는 바인드하지 않음 → 샌드박스 내부에서 보이지 않음.
 */
export function buildBwrapArgs(input: SandboxInput, cfg: SandboxConfig): string[] {
    const workdir = path.join(cfg.sandboxRoot, sanitizeId(input.serverId));
    const a: string[] = [];
    for (const p of cfg.roBinds) a.push('--ro-bind-try', p, p);
    a.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp');
    a.push('--bind', workdir, workdir, '--chdir', workdir);
    a.push('--bind-try', cfg.npmCache, cfg.npmCache); // npx/uvx 캐시 (쓰기)
    a.push('--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts');
    if ((input.network ?? 'full') === 'none') a.push('--unshare-net');
    a.push('--die-with-parent', '--new-session');
    return a;
}

const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(msg);
}

/**
 * 외부 MCP stdio command 를 bwrap 으로 감싼다. 게이트 미충족 시 원본 그대로(no-op).
 * @param cfg 테스트 주입용 — 기본 defaultSandboxConfig()
 */
export function buildSandboxedCommand(input: SandboxInput, cfg: SandboxConfig = defaultSandboxConfig()): SandboxResult {
    if (!cfg.enabled) return { command: input.command, args: input.args, sandboxed: false };
    if (cfg.platform !== 'linux') {
        warnOnce('platform', `MCP 샌드박스는 Linux 전용 — ${cfg.platform} 에서는 미적용(비격리 실행). 운영(Linux)에서 활성화하세요.`);
        return { command: input.command, args: input.args, sandboxed: false };
    }
    if (!cfg.bwrapPath) {
        warnOnce('bwrap', 'bwrap 바이너리를 찾지 못해 MCP 샌드박스 미적용(비격리 실행). `apt install bubblewrap` 필요.');
        return { command: input.command, args: input.args, sandboxed: false };
    }
    const workdir = path.join(cfg.sandboxRoot, sanitizeId(input.serverId));
    try {
        fs.mkdirSync(workdir, { recursive: true });
    } catch (e) {
        logger.warn(`샌드박스 작업 디렉토리 생성 실패 — 비격리 실행: ${e instanceof Error ? e.message : String(e)}`);
        return { command: input.command, args: input.args, sandboxed: false };
    }
    const bwrapArgs = buildBwrapArgs(input, cfg);
    return { command: cfg.bwrapPath, args: [...bwrapArgs, '--', input.command, ...input.args], sandboxed: true };
}
