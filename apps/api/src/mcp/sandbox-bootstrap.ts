/**
 * ============================================================
 * MCP Sandbox Bootstrap — 샌드박스 자세(posture) 관측 + 셋업 시 secure-by-default
 * ============================================================
 *
 * 두 가지만 한다 (spawn 경로는 건드리지 않는다 — 그건 sandbox-docker.ts):
 *
 * 1. sandboxBootAdvisory — 부팅 시 1회 자세 점검 (관측 전용, 동작 무변경):
 *    - OFF 인데 docker 가용 → 격리 권장 안내
 *    - ON 인데 docker 부재 → 외부 MCP spawn 이 전부 fail-closed 거부될 것을 조기 경보
 *      (그전엔 첫 spawn 실패에서야 드러났다 — 조용한 실패 방지)
 *
 * 2. ensureSandboxDefaultOnSetup — 첫 실행 셋업 마법사에서 호출:
 *    MCP_SANDBOX_ENABLED 미설정 + docker + 런타임 이미지 모두 가용일 때만
 *    `.env` 에 true 를 영속하고 process.env 에 주입한다 (boot/ensure-secrets 와 같은 패턴).
 *    - 명시 설정(true/false)은 존중 — 덮어쓰지 않는다.
 *    - ⚠️ docker 바이너리 존재 ≠ 이미지 존재: 이미지(openmake-mcp-runtime) 없이 켜면
 *      모든 외부 MCP spawn 이 이미지 pull 실패로 깨진다. 반드시 둘 다 확인.
 *    - 실패는 전부 fail-open (셋업을 죽이지 않음) — 미적용 사유를 반환하고,
 *      다음 부팅의 sandboxBootAdvisory 가 OFF 상태를 다시 드러낸다 (알아챌 경로 확보).
 *
 * @module mcp/sandbox-bootstrap
 */
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import {
    defaultSandboxConfig, resolveDocker, type SandboxConfig,
    MCP_SANDBOX_ROLE_LABEL, MCP_SANDBOX_PID_LABEL_KEY,
} from './sandbox-docker';
import { MCP_SANDBOX_BOOTSTRAP } from '../config/runtime-limits';

/** ENABLED=false 상태에서도 docker 를 탐색해야 하므로 resolver 를 분리 (테스트 주입 가능) */
function resolveConfiguredDocker(): string | null {
    return resolveDocker(process.env.MCP_SANDBOX_DOCKER_PATH || 'docker');
}

/**
 * 부팅 시 샌드박스 자세 점검 — 경고할 것이 있으면 메시지, 정상이면 null.
 * 관측 전용: 어떤 상태도 바꾸지 않는다.
 */
export function sandboxBootAdvisory(
    cfg: SandboxConfig = defaultSandboxConfig(),
    resolveDockerFn: () => string | null = resolveConfiguredDocker,
): string | null {
    if (cfg.enabled) {
        if (cfg.dockerPath) return null;
        return (
            'MCP 샌드박스가 활성(MCP_SANDBOX_ENABLED=true)인데 docker 바이너리를 찾을 수 없습니다 — ' +
            '외부 MCP 서버 spawn 이 전부 거부됩니다(fail-closed). Docker 설치/실행을 확인하거나 ' +
            'MCP_SANDBOX_ENABLED=false 로 명시 해제하세요.'
        );
    }
    const dockerPath = resolveDockerFn();
    if (!dockerPath) return null; // docker 없는 배포 — 샌드박스 불가, 안내 무의미
    return (
        'MCP 샌드박스가 꺼져 있는데 docker 가 가용합니다 — 외부 MCP 서버가 호스트에서 비격리로 실행됩니다. ' +
        'MCP_SANDBOX_ENABLED=true + 런타임 이미지 빌드(docker build -t openmake-mcp-runtime:latest infra/mcp-runtime)를 권장합니다.'
    );
}

export interface SandboxDefaultResult {
    /** true = .env 영속 + process.env 주입 완료 */
    applied: boolean;
    /** 미적용 사유: explicit(명시 설정 존중) | no-docker | no-image | persist-failed */
    reason: 'applied' | 'explicit' | 'no-docker' | 'no-image' | 'persist-failed';
}

/** 테스트 주입용 의존성 — 미지정 시 실제 docker 를 조회한다 */
export interface SandboxDefaultDeps {
    resolveDockerPath?: () => string | null;
    imageExists?: (dockerPath: string, image: string) => boolean;
}

/** `docker image inspect` 로 런타임 이미지 존재 확인 — 데몬 정지 대비 timeout 필수 */
function dockerImageExists(dockerPath: string, image: string): boolean {
    try {
        execFileSync(dockerPath, ['image', 'inspect', image], {
            stdio: 'ignore',
            timeout: MCP_SANDBOX_BOOTSTRAP.DOCKER_PROBE_TIMEOUT_MS,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * 첫 실행 셋업에서 MCP 샌드박스 기본 활성화 시도.
 * 전 경로 fail-open — 어떤 실패도 throw 하지 않고 사유를 반환한다.
 */
export function ensureSandboxDefaultOnSetup(
    envPath: string,
    deps: SandboxDefaultDeps = {},
): SandboxDefaultResult {
    // 명시 설정(true/false 무엇이든)은 운영자 선택 — 덮어쓰지 않는다
    if (process.env.MCP_SANDBOX_ENABLED !== undefined && process.env.MCP_SANDBOX_ENABLED !== '') {
        return { applied: false, reason: 'explicit' };
    }

    const dockerPath = (deps.resolveDockerPath ?? resolveConfiguredDocker)();
    if (!dockerPath) return { applied: false, reason: 'no-docker' };

    const image = defaultSandboxConfig().image;
    const hasImage = (deps.imageExists ?? dockerImageExists)(dockerPath, image);
    if (!hasImage) return { applied: false, reason: 'no-image' };

    const block =
        `\n# ── 첫 실행 셋업 자동 설정 (${new Date().toISOString()}) ──\n` +
        `# docker + 런타임 이미지(${image}) 감지 → 외부 MCP 컨테이너 격리를 기본 활성화.\n` +
        `MCP_SANDBOX_ENABLED=true\n`;
    try {
        if (fs.existsSync(envPath)) {
            fs.appendFileSync(envPath, block, 'utf-8');
        } else {
            fs.writeFileSync(envPath, block, { encoding: 'utf-8', mode: 0o600 });
        }
    } catch {
        return { applied: false, reason: 'persist-failed' };
    }

    // defaultSandboxConfig 가 spawn 마다 process.env 를 읽으므로 재시작 없이 즉시 반영된다
    process.env.MCP_SANDBOX_ENABLED = 'true';
    return { applied: true, reason: 'applied' };
}

// ── 고아 컨테이너 부팅 스윕 ──────────────────────────────────────────────
// 실사례(2026-09-01): close() 의 SIGKILL 이 docker CLI 만 죽이고, stdin EOF 를
// 무시하는 서버(mcp-python-repl)가 컨테이너로 이틀간 잔존(앱 재시작 3회 생존).
// 판정은 결정적 — 라벨의 소유 pid 가 죽었으면 그 컨테이너의 stdio 상대는 이미
// 없으므로 어떤 경우에도 쓸모없다. ⚠️ 라벨 스코핑 필수: task-sandbox 는 재시작을
// 넘어 살아있는 것이 정상(작업 재개용)이라 이미지 기준 무차별 스윕은 금지.

export interface OrphanReapResult {
    scanned: number;
    reaped: number;
    /** 판정 불가(라벨 pid 없음/파싱 실패)로 건너뛴 수 — 안전측: 모르면 건드리지 않는다 */
    skipped: number;
    errors: string[];
}

/** 테스트 주입용 — 미지정 시 실제 docker/kill(pid,0) 사용 */
export interface OrphanReapDeps {
    resolveDockerPath?: () => string | null;
    /** docker 하위명령 실행 → stdout (실패 시 throw) */
    dockerExec?: (dockerPath: string, args: string[], timeoutMs: number) => string;
    pidAlive?: (pid: number) => boolean;
}

function defaultDockerExec(dockerPath: string, args: string[], timeoutMs: number): string {
    return execFileSync(dockerPath, args, { encoding: 'utf-8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** ESRCH 만 사망으로 판정 — EPERM 등 그 외는 생존 취급(fail-open, 오살 방지) */
function defaultPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

/**
 * 소유 프로세스가 죽은 MCP 샌드박스 컨테이너를 정리한다. 부팅 시 1회 호출.
 * 전 경로 fail-open — docker 부재/정지(hang 은 timeout)·개별 실패가 부팅을 막지 않는다.
 */
export function reapOrphanSandboxContainers(deps: OrphanReapDeps = {}): OrphanReapResult {
    const result: OrphanReapResult = { scanned: 0, reaped: 0, skipped: 0, errors: [] };
    if (!MCP_SANDBOX_BOOTSTRAP.ORPHAN_REAP_ENABLED) return result;

    const dockerPath = (deps.resolveDockerPath ?? resolveConfiguredDocker)();
    if (!dockerPath) return result;

    const exec = deps.dockerExec ?? defaultDockerExec;
    const alive = deps.pidAlive ?? defaultPidAlive;
    const probeMs = MCP_SANDBOX_BOOTSTRAP.DOCKER_PROBE_TIMEOUT_MS;

    let ids: string[];
    try {
        ids = exec(dockerPath, ['ps', '-q', '--filter', `label=${MCP_SANDBOX_ROLE_LABEL}`], probeMs)
            .split('\n').map((s) => s.trim()).filter(Boolean)
            .slice(0, MCP_SANDBOX_BOOTSTRAP.ORPHAN_REAP_MAX);
    } catch (err) {
        result.errors.push(`ps: ${err instanceof Error ? err.message : String(err)}`);
        return result;
    }

    for (const id of ids) {
        result.scanned += 1;
        try {
            const raw = exec(
                dockerPath,
                ['inspect', '-f', `{{index .Config.Labels "${MCP_SANDBOX_PID_LABEL_KEY}"}}`, id],
                probeMs,
            ).trim();
            const pid = parseInt(raw, 10);
            if (!Number.isFinite(pid) || pid <= 0) {
                result.skipped += 1; // 판정 불가 — 건드리지 않는다
                continue;
            }
            if (alive(pid)) continue; // 소유 프로세스 생존 — 정상 컨테이너
            exec(dockerPath, ['stop', id], MCP_SANDBOX_BOOTSTRAP.DOCKER_STOP_TIMEOUT_MS); // --rm 이라 stop = 제거
            result.reaped += 1;
        } catch (err) {
            result.errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return result;
}
