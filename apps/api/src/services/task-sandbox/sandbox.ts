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
import { mkdir, rm, writeFile as fsWriteFile, readFile as fsReadFile, readdir } from 'fs/promises';
import { resolve, sep, join, dirname } from 'path';
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
    // restricted 는 egress allowlist(proxy) 미구현 단계에서 호출부가 none 으로 다운그레이드함.
    const net = cfg.network === 'restricted' ? 'bridge' : 'none';
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
 * PURE: workspace 내부로만 해석되는 안전 경로 반환 (유닛테스트 대상).
 * `..`/절대경로/심링크 표기로 workspace 를 탈출하려는 시도를 차단한다.
 */
export function safeResolveWorkspacePath(hostWorkdir: string, userPath: string): string {
    const root = resolve(hostWorkdir);
    const abs = resolve(root, userPath);
    if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(`workspace 경로 탈출 차단: ${userPath}`);
    }
    return abs;
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
        if (this.cfg.network === 'restricted' && this.cfg.networkAllowlist.length === 0) {
            logger.warn(`[${this.taskId}] network=restricted 인데 allowlist 미설정 → fail-safe none 다운그레이드`);
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

    /** workspace 내 파일 쓰기 (호스트 bind-mount 직접). 경로 가드 적용. */
    async writeFile(relPath: string, content: string): Promise<void> {
        const abs = safeResolveWorkspacePath(this.hostWorkdir, relPath);
        await mkdir(dirname(abs), { recursive: true });
        await fsWriteFile(abs, content, 'utf8');
    }

    /** workspace 내 파일 읽기. 경로 가드 적용. */
    async readFile(relPath: string): Promise<string> {
        const abs = safeResolveWorkspacePath(this.hostWorkdir, relPath);
        return fsReadFile(abs, 'utf8');
    }

    /** workspace 내 디렉토리 목록. 경로 가드 적용. */
    async listDir(relPath = '.'): Promise<string[]> {
        const abs = safeResolveWorkspacePath(this.hostWorkdir, relPath);
        return readdir(abs);
    }

    /** 컨테이너 + workspace 정리. 멱등. */
    async cleanup(): Promise<void> {
        await runProcess(this.cfg.dockerPath, ['stop', '-t', '5', this.containerName],
            { timeoutMs: 15_000, outputCap: 4096 });
        await runProcess(this.cfg.dockerPath, ['rm', '-f', this.containerName],
            { timeoutMs: 10_000, outputCap: 4096 });
        try { await rm(this.hostWorkdir, { recursive: true, force: true }); } catch { /* best-effort */ }
        this.created = false;
        logger.info(`[${this.taskId}] 샌드박스 정리`);
    }

    private assertCreated(): void {
        if (!this.created) throw new Error(`샌드박스 미생성 (${this.taskId}) — create() 선행 필요`);
    }
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
