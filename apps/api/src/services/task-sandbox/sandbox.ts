/**
 * ============================================================
 * Task Sandbox — Manus형 영속 가상 컴퓨터 (Phase 1 / C1)
 * ============================================================
 *
 * task별 영속 Docker 컨테이너(`tail -f /dev/null`)를 생성하고, 에이전트가
 * bash/python/파일 도구를 `docker exec` 로 반복 실행한다. workspace 볼륨이
 * 단계 간 파일을 누적해 "가상 컴퓨터" 속성을 제공한다. (mcp/sandbox-docker.ts 의
 * 일회성 격리와 별개 — 이쪽은 장수 컨테이너.)
 *
 * 보안: --cap-drop ALL · no-new-privileges · non-root · --read-only(루트) +
 *   /workspace 볼륨만 rw · network none(기본) · mem/cpu/pids 한도 · exec timeout.
 *   C0 PoC(9/9) 로 검증된 플래그 세트.
 *
 * @module services/task-sandbox/sandbox
 */
import { spawn } from 'child_process';
import { mkdir, rm, writeFile as fsWriteFile, readFile as fsReadFile, readdir, stat, realpath } from 'fs/promises';
import { resolve, sep, join, dirname, basename, relative } from 'path';
import { getTaskSandboxConfig, type TaskSandboxConfig } from '../../config/task-sandbox';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TaskSandbox');

const CONTAINER_PREFIX = 'omk-task-';
const WORKSPACE = '/workspace';

/** docker 식별자 안전화. */
export function sanitizeId(id: string): string {
    return id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'unknown';
}

/**
 * PURE: 영속 컨테이너 `docker run` 인자 조립 (유닛테스트 대상).
 * mcp/sandbox-docker buildDockerArgs 보안 플래그를 영속(-d + tail) 형태로 미러.
 */
export function buildRunArgs(
    containerName: string,
    hostWorkdir: string,
    cfg: TaskSandboxConfig,
): string[] {
    // restricted(allowlist egress)는 메인 샌드박스에 대한 enforcement 가 미구현 —
    // bridge 로 열면 무제한 egress 가 되므로 구현 전까지 none 으로 fail-safe 매핑한다.
    // (browser 도구는 별도 일회성 컨테이너 + egress proxy 로 네트워크를 얻는다.)
    const net = 'none';
    const a: string[] = ['run', '-d', '--init', '--name', containerName];
    a.push('--network', net);
    a.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges');
    a.push('--pids-limit', String(cfg.pidsLimit), '--memory', cfg.memory, '--cpus', cfg.cpus);
    a.push('--user', cfg.user);
    a.push('--read-only', '--tmpfs', '/tmp:rw,exec', '--tmpfs', '/run:rw');
    a.push('-v', `${hostWorkdir}:${WORKSPACE}:rw`);
    a.push('-w', WORKSPACE);
    a.push(cfg.image, 'tail', '-f', '/dev/null');
    return a;
}

/**
 * PURE: 브라우저 전용 일회성 컨테이너 `docker run --rm` 인자 (유닛테스트 대상).
 * 메인 샌드박스(network none)와 분리 — browser 만 browserNetwork(기본 bridge)에서 실행해
 * bash/python 의 인터넷 미접근을 보장한다. workspace 는 공유(스크린샷·결과 저장).
 */
export function buildBrowserRunArgs(
    hostWorkdir: string,
    actionsRelPath: string,
    cfg: TaskSandboxConfig,
    proxyUrl?: string,
): string[] {
    const a: string[] = ['run', '--rm', '--init'];
    // egress 프록시 ON: internal 망(인터넷 직접 차단) + 프록시 env. OFF: browserNetwork(bridge).
    a.push('--network', proxyUrl ? cfg.egressNetwork : (cfg.browserNetwork || 'bridge'));
    a.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges');
    a.push('--pids-limit', String(cfg.pidsLimit), '--memory', cfg.memory, '--cpus', cfg.cpus);
    a.push('--user', cfg.user);
    a.push('--read-only', '--tmpfs', '/tmp:rw,exec', '--tmpfs', '/run:rw');
    a.push('-v', `${hostWorkdir}:${WORKSPACE}:rw`);
    a.push('-w', WORKSPACE);
    if (proxyUrl) a.push('-e', `BROWSER_PROXY=${proxyUrl}`);
    a.push(cfg.image, 'node', '/opt/browser/browser-runner.mjs', actionsRelPath);
    return a;
}

/**
 * PURE: workspace 내부로만 해석되는 안전 경로 반환 (유닛테스트 대상).
 * `..`/절대경로 표기 탈출을 차단하는 **어휘적(1차)** 가드 — 심링크는 해석하지 않으므로
 * 실제 파일 I/O 전에는 반드시 safeRealWorkspacePath 로 실경로까지 검증할 것.
 */
export function safeResolveWorkspacePath(hostWorkdir: string, userPath: string): string {
    const root = resolve(hostWorkdir);
    const abs = resolve(root, userPath);
    if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(`workspace 경로 탈출 차단: ${userPath}`);
    }
    return abs;
}

/**
 * workspace 내부로만 해석되는 안전 **실경로** 반환 — 심링크 탈출 차단(2차 가드).
 *
 * 컨테이너의 bash 가 bind-mount 안에 호스트 경로를 가리키는 심링크를 만들 수 있고,
 * 파일 I/O(fs.readFile/writeFile/rm)와 res.download 는 호스트에서 심링크를 따라가므로
 * 어휘적 검사만으로는 호스트 임의 파일 읽기/쓰기로 탈출한다. 여기서는 대상 경로의
 * 가장 깊은 실존 조상을 realpath 로 해석해 그 실경로가 workspace 실경로 내부인지
 * 강제한다(미실존 꼬리 세그먼트는 실존 조상의 실경로에 다시 붙여 반환).
 */
export async function safeRealWorkspacePath(hostWorkdir: string, userPath: string): Promise<string> {
    const abs = safeResolveWorkspacePath(hostWorkdir, userPath);
    const realRoot = await realpath(resolve(hostWorkdir));
    let probe = abs;
    let rest = '';
    for (;;) {
        let real: string | null = null;
        try {
            real = await realpath(probe);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
            const parent = dirname(probe);
            if (parent === probe) throw e; // 파일시스템 루트까지 미실존 — 비정상
            rest = rest ? join(basename(probe), rest) : basename(probe);
            probe = parent;
            continue;
        }
        const mapped = rest ? join(real, rest) : real;
        if (mapped !== realRoot && !mapped.startsWith(realRoot + sep)) {
            throw new Error(`workspace 경로 탈출 차단(symlink): ${userPath}`);
        }
        return mapped;
    }
}

export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    truncated: boolean;
    timedOut: boolean;
    durationMs: number;
}

/** 자식 프로세스를 실행하고 출력 캡/timeout 을 적용 (docker CLI 호출 공용). */
function runProcess(
    dockerPath: string,
    args: string[],
    opts: { timeoutMs: number; outputCap: number; input?: string },
): Promise<ExecResult> {
    return new Promise((resolvePromise) => {
        const started = Date.now();
        const child = spawn(dockerPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let truncated = false;
        let timedOut = false;

        const onData = (buf: Buffer, which: 'out' | 'err') => {
            const cur = which === 'out' ? stdout.length : stderr.length;
            if (cur >= opts.outputCap) { truncated = true; return; }
            const chunk = buf.toString('utf8', 0, Math.max(0, opts.outputCap - cur));
            if (which === 'out') stdout += chunk; else stderr += chunk;
            if (cur + buf.length > opts.outputCap) truncated = true;
        };
        child.stdout.on('data', (b) => onData(b, 'out'));
        child.stderr.on('data', (b) => onData(b, 'err'));

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, opts.timeoutMs);

        child.on('close', (code) => {
            clearTimeout(timer);
            resolvePromise({
                stdout, stderr,
                exitCode: code ?? -1,
                truncated, timedOut,
                durationMs: Date.now() - started,
            });
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            resolvePromise({
                stdout, stderr: stderr + String(err),
                exitCode: -1, truncated, timedOut,
                durationMs: Date.now() - started,
            });
        });

        if (opts.input !== undefined) { child.stdin.write(opts.input); }
        child.stdin.end();
    });
}

/**
 * 단일 task 의 영속 샌드박스. create() → exec()/파일 I/O 반복 → cleanup().
 * 파일 I/O 는 bind-mount 된 호스트 workdir 에 직접 수행(빠르고 docker cp 불요).
 */
export class TaskSandbox {
    readonly taskId: string;
    readonly containerName: string;
    readonly hostWorkdir: string;
    private readonly cfg: TaskSandboxConfig;
    private created = false;

    constructor(taskId: string, cfg: TaskSandboxConfig = getTaskSandboxConfig()) {
        this.taskId = taskId;
        this.cfg = cfg;
        const safe = sanitizeId(taskId);
        this.containerName = `${CONTAINER_PREFIX}${safe}`;
        this.hostWorkdir = join(cfg.workspaceRoot, safe);
    }

    /** 영속 컨테이너 생성. workspace 디렉토리 준비 + docker run -d. */
    async create(): Promise<void> {
        if (this.created) return;
        if (this.cfg.network === 'restricted') {
            logger.warn(`[${this.taskId}] network=restricted 는 메인 샌드박스 enforcement 미구현 → fail-safe none 으로 실행`);
        }
        await mkdir(this.hostWorkdir, { recursive: true, mode: 0o777 });
        // 동명 잔존 컨테이너 제거(이전 비정상 종료 대비).
        await runProcess(this.cfg.dockerPath, ['rm', '-f', this.containerName],
            { timeoutMs: 10_000, outputCap: 4096 });
        const args = buildRunArgs(this.containerName, this.hostWorkdir, this.cfg);
        const r = await runProcess(this.cfg.dockerPath, args, { timeoutMs: 30_000, outputCap: 8192 });
        if (r.exitCode !== 0) {
            throw new Error(`task 샌드박스 생성 실패 (${this.taskId}): ${r.stderr || r.stdout}`);
        }
        this.created = true;
        logger.info(`[${this.taskId}] 샌드박스 생성 (${this.containerName}, ${r.durationMs}ms)`);
    }

    /** 컨테이너 내부에서 셸 명령 실행 (bash 도구의 실행 백엔드). */
    async exec(command: string): Promise<ExecResult> {
        this.assertCreated();
        return runProcess(
            this.cfg.dockerPath,
            ['exec', this.containerName, 'sh', '-c', command],
            { timeoutMs: this.cfg.execTimeoutMs, outputCap: this.cfg.outputCap },
        );
    }

    /** 브라우저 도구 활성 여부. */
    get isBrowserEnabled(): boolean { return this.cfg.browserEnabled; }

    /**
     * 브라우저 액션을 별도 일회성 컨테이너(browserNetwork)에서 실행 — 메인 컨테이너(network none)와
     * 분리해 bash/python 인터넷 미접근 보장. workspace 공유(스크린샷 저장). actionsRelPath 는 사전에 쓰여 있어야 함.
     */
    async runBrowser(actionsRelPath: string): Promise<ExecResult> {
        this.assertCreated();
        // egress 프록시 ON: internal 망 + 프록시 보장 후 그 URL 을 브라우저에 주입.
        let proxyUrl: string | undefined;
        if (this.cfg.egressProxyEnabled) {
            const { ensureEgressProxy } = await import('./egress-proxy');
            proxyUrl = await ensureEgressProxy(this.cfg);
        }
        const args = buildBrowserRunArgs(this.hostWorkdir, actionsRelPath, this.cfg, proxyUrl);
        return runProcess(this.cfg.dockerPath, args, {
            timeoutMs: Math.max(this.cfg.execTimeoutMs, 90_000),
            outputCap: this.cfg.outputCap,
        });
    }

    /** workspace 내 파일 쓰기 (호스트 bind-mount 직접). 경로 가드(어휘+실경로) 적용. */
    async writeFile(relPath: string, content: string): Promise<void> {
        const abs = await safeRealWorkspacePath(this.hostWorkdir, relPath);
        await mkdir(dirname(abs), { recursive: true });
        await fsWriteFile(abs, content, 'utf8');
    }

    /** workspace 내 파일 읽기. 경로 가드(어휘+실경로) 적용. */
    async readFile(relPath: string): Promise<string> {
        const abs = await safeRealWorkspacePath(this.hostWorkdir, relPath);
        return fsReadFile(abs, 'utf8');
    }

    /** workspace 내 디렉토리 목록. 경로 가드(어휘+실경로) 적용. */
    async listDir(relPath = '.'): Promise<string[]> {
        const abs = await safeRealWorkspacePath(this.hostWorkdir, relPath);
        return readdir(abs);
    }

    /** 산출물 회수용 — workspace 전체 파일을 상대경로로 재귀 나열. */
    async listWorkspaceFiles(): Promise<string[]> {
        return listWorkspaceFilesAt(this.hostWorkdir);
    }

    /** workspace 내 파일/디렉토리 삭제. 경로 가드(어휘+실경로) 적용. */
    async deleteFile(relPath: string): Promise<void> {
        const abs = await safeRealWorkspacePath(this.hostWorkdir, relPath);
        if (abs === await realpath(resolve(this.hostWorkdir))) throw new Error('workspace 루트는 삭제할 수 없습니다');
        await rm(abs, { recursive: true, force: true });
    }

    /**
     * 컨테이너 정리. 멱등. removeWorkspace=true(기본) 면 workspace 도 삭제,
     * false 면 산출물 회수(다운로드)를 위해 workspace 를 보존하고 컨테이너만 제거한다.
     */
    async cleanup(removeWorkspace = true): Promise<void> {
        await runProcess(this.cfg.dockerPath, ['stop', '-t', '5', this.containerName],
            { timeoutMs: 15_000, outputCap: 4096 });
        await runProcess(this.cfg.dockerPath, ['rm', '-f', this.containerName],
            { timeoutMs: 10_000, outputCap: 4096 });
        if (removeWorkspace) {
            try { await rm(this.hostWorkdir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
        this.created = false;
        logger.info(`[${this.taskId}] 샌드박스 정리 (workspace ${removeWorkspace ? '삭제' : '보존'})`);
    }

    private assertCreated(): void {
        if (!this.created) throw new Error(`샌드박스 미생성 (${this.taskId}) — create() 선행 필요`);
    }
}

/**
 * 주어진 workspace 디렉토리의 전체 파일을 상대경로로 재귀 나열 (산출물 다운로드 엔드포인트용).
 * 라이브 TaskSandbox 인스턴스 없이도 동작(task 완료 후 workspace_path 로 호출).
 */
export async function listWorkspaceFilesAt(root: string, maxFiles = 1000): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
        if (out.length >= maxFiles) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (out.length >= maxFiles) return;
            const full = join(dir, e.name);
            if (e.isDirectory()) await walk(full);
            else out.push(relative(root, full));
        }
    }
    await walk(resolve(root));
    return out.sort();
}

/**
 * workspace 보존 TTL 스윕 — workspaceRoot 하위에서 mtime 이 TTL 초과한 디렉토리를 삭제.
 * 완료 task 의 산출물 workspace 가 무한 누적되는 것을 막는다(now 는 호출부가 주입 — 결정성).
 */
export async function reapStaleWorkspaces(
    nowMs: number,
    cfg: TaskSandboxConfig = getTaskSandboxConfig(),
): Promise<number> {
    let removed = 0;
    let entries;
    try { entries = await readdir(cfg.workspaceRoot, { withFileTypes: true }); } catch { return 0; }
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        const dir = join(cfg.workspaceRoot, e.name);
        try {
            const s = await stat(dir);
            if (nowMs - s.mtimeMs > cfg.workspaceTtlMs) {
                await rm(dir, { recursive: true, force: true });
                removed++;
            }
        } catch { /* best-effort */ }
    }
    if (removed) logger.info(`stale workspace ${removed}개 정리(TTL ${cfg.workspaceTtlMs}ms)`);
    return removed;
}

/**
 * 부팅 시 고아 task 컨테이너(omk-task-*) 청소 — 비정상 종료로 남은 컨테이너 회수.
 */
export async function reapOrphanTaskSandboxes(cfg: TaskSandboxConfig = getTaskSandboxConfig()): Promise<number> {
    const list = await runProcess(cfg.dockerPath,
        ['ps', '-aq', '--filter', `name=${CONTAINER_PREFIX}`], { timeoutMs: 10_000, outputCap: 65536 });
    const ids = list.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    for (const id of ids) {
        await runProcess(cfg.dockerPath, ['rm', '-f', id], { timeoutMs: 10_000, outputCap: 4096 });
    }
    if (ids.length) logger.info(`고아 task 샌드박스 ${ids.length}개 청소`);
    return ids.length;
}
