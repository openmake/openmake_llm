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
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { mkdir, rm, writeFile as fsWriteFile, readFile as fsReadFile, readdir, stat, lstat, realpath, copyFile as fsCopyFile } from 'fs/promises';
import { resolve, sep, join, dirname, basename, relative } from 'path';
import { getTaskSandboxConfig, BROWSER_SESSION, type TaskSandboxConfig } from '../../config/task-sandbox';
import { BROWSER_RUN } from '../../config/agent-task-browser-web';
import type { TaskExecutor, ExecResult } from './executor';
import { SANDBOX_WORKSPACE_DIR, stripWorkspacePrefix } from './workspace-path';
import { createLogger } from '../../utils/logger';

// 기존 소비처(runtime/tools 등)가 './sandbox' 에서 ExecResult 를 import 하므로 재노출 유지.
export type { ExecResult } from './executor';

const logger = createLogger('TaskSandbox');

const CONTAINER_PREFIX = 'omk-task-';
const WORKSPACE = SANDBOX_WORKSPACE_DIR;

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
    a.push('--pids-limit', String(cfg.pidsLimit), '--memory', cfg.memory, '--memory-swap', cfg.memory, '--cpus', cfg.cpus);
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
    /** 시간 초과 때 지울 수 있게 붙이는 이름(browserRunContainerName). */
    containerName?: string,
): string[] {
    const a: string[] = ['run', '--rm', '--init', ...(containerName ? ['--name', containerName] : [])];
    // egress 프록시 ON: internal 망(인터넷 직접 차단) + 프록시 env. OFF: browserNetwork(bridge).
    a.push('--network', proxyUrl ? cfg.egressNetwork : (cfg.browserNetwork || 'bridge'));
    a.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges');
    a.push('--pids-limit', String(cfg.pidsLimit), '--memory', cfg.memory, '--memory-swap', cfg.memory, '--cpus', cfg.cpus);
    a.push('--user', cfg.user);
    a.push('--read-only', '--tmpfs', '/tmp:rw,exec', '--tmpfs', '/run:rw');
    a.push('-v', `${hostWorkdir}:${WORKSPACE}:rw`);
    a.push('-w', WORKSPACE);
    if (proxyUrl) a.push('-e', `BROWSER_PROXY=${proxyUrl}`);
    a.push(cfg.image, 'node', '/opt/browser/browser-runner.mjs', actionsRelPath);
    return a;
}

/** 일회성 브라우저 컨테이너 이름 — 접두 + 작업 id + 호출마다 다른 꼬리(같은 작업의 호출이 겹쳐도 충돌하지 않는다). */
export function browserRunContainerName(taskId: string): string {
    return `${BROWSER_RUN.CONTAINER_PREFIX}${sanitizeId(taskId)}-${randomUUID().slice(0, 8)}`;
}

/**
 * PURE: 컨테이너 안에서 파일을 쓰는 `docker exec` 인자 (유닛테스트 대상). 내용은 stdin 으로 넘긴다.
 * 경로는 셸 문자열에 넣지 않고 위치 인자($1)로 넘긴다 — 공백·메타문자가 있어도 명령으로 해석되지 않는다.
 */
export function buildWriteArgs(containerName: string, containerPath: string): string[] {
    return ['exec', '-i', containerName, 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', containerPath];
}

/**
 * PURE: workspace 내부로만 해석되는 안전 경로 반환 (유닛테스트 대상).
 * `..`/절대경로 표기 탈출을 차단하는 **어휘적(1차)** 가드 — 심링크는 해석하지 않으므로
 * 실제 파일 I/O 전에는 반드시 safeRealWorkspacePath 로 실경로까지 검증할 것.
 *
 * 컨테이너 절대경로(`/workspace/...`)는 **탈출이 아니라 같은 파일의 다른 표기**다. 에이전트는
 * 컨테이너 안에서 bash 로 작업하므로 `/workspace/data.json` 이 눈에 보이는 정확한 경로이고,
 * 실제로 그렇게 쓴다 — 그런데 이 검사는 호스트 경로(hostWorkdir) 기준이라 탈출로 판정했다.
 * 2026-07-22 ~ 08-02 사이 예약 리포트가 `/workspace/data.json`·`/workspace/report.html` 로
 * 반복 차단당하며 턴을 낭비했고, 08-03 실행은 마지막 턴에 이 차단을 맞아 재시도할 턴이 없어
 * 리포트 없이 끝났다. 마운트 지점을 상대경로로 정규화해 같은 대상을 같게 해석한다.
 * 정규화 뒤에도 검사는 그대로 적용되므로 `/workspace/../etc/passwd` 는 여전히 차단된다.
 */
export function safeResolveWorkspacePath(hostWorkdir: string, userPath: string): string {
    const root = resolve(hostWorkdir);
    const normalized = stripWorkspacePrefix(userPath);
    const abs = resolve(root, normalized);
    if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(
            `workspace 경로 탈출 차단: ${userPath}`
            + ' (파일 도구는 /workspace 내부만 접근 가능 — /opt/... 같은 컨테이너 경로는'
            + ' bash 로 `cp -r <경로> ./` 하여 workspace 에 복사한 뒤 사본을 여세요)',
        );
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
            // realpath ENOENT 는 "경로 없음" 과 "대상이 없는 심링크" 를 구분하지 못한다. 후자를 미실존으로
            // 넘기면 부모 실경로 + 이름으로 통과해 writeFile 이 링크를 따라 밖에 파일을 만든다(2026-09-06).
            if (await lstat(probe).then(() => true, () => false)) {
                throw new Error(`workspace 경로 탈출 차단(symlink): ${userPath}`);
            }
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

/** exec 한 번을 식별하는 환경변수 — 그 명령이 띄운 프로세스(백그라운드·데몬 포함)가 모두 물려받는다. */
const EXEC_ID_ENV = 'OMK_EXEC_ID';

/**
 * PURE: 실행 id 꼬리표가 붙은 컨테이너 안 프로세스를 모두 죽이는 `docker exec` 인자 (유닛테스트 대상).
 * `docker exec` CLI 를 죽여도 컨테이너 안 프로세스는 남는다(실측) — 타임아웃·취소 때 이걸로 정리한다.
 * 죽이는 사이 새로 생긴 자식을 잡으려고 남은 것이 없을 때까지 최대 3회 훑는다. 이미지에 ps/pkill 이 없어 /proc 을 읽는다.
 */
export function buildKillExecArgs(containerName: string, execId: string): string[] {
    const script = 'for i in 1 2 3; do n=0; for p in /proc/[0-9]*; do '
        + `if { tr '\\0' '\\n' < "$p/environ"; } 2>/dev/null | grep -qx "${EXEC_ID_ENV}=$1"; then kill -9 "\${p#/proc/}" 2>/dev/null; n=1; fi; `
        + 'done; [ "$n" = 0 ] && break; done; exit 0';
    return ['exec', containerName, 'sh', '-c', script, 'sh', execId];
}

/** 자식 프로세스를 실행하고 출력 캡/timeout 을 적용 (docker CLI 호출 공용). */
export function runProcess(
    dockerPath: string,
    args: string[],
    /** signal·onStop — 타임아웃/중단으로 끝낼 때 CLI 를 죽이기 전에 onStop 으로 컨테이너 안 프로세스를 정리한다. */
    opts: { timeoutMs: number; outputCap: number; input?: string | Buffer; signal?: AbortSignal; onStop?: () => Promise<unknown> },
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

        const stop = (): void => {
            void Promise.resolve(opts.onStop?.()).catch(() => { /* 정리 실패해도 CLI 는 끝낸다 */ }).finally(() => child.kill('SIGKILL'));
        };
        const timer = setTimeout(() => {
            timedOut = true;
            stop();
        }, opts.timeoutMs);
        opts.signal?.addEventListener('abort', stop, { once: true });

        child.on('close', (code) => {
            clearTimeout(timer);
            opts.signal?.removeEventListener('abort', stop);
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

        // 자식이 stdin 을 다 읽기 전에 끝나면 EPIPE 가 난다 — 결과는 종료 코드로 판정하므로 여기서는 삼킨다
        // (처리하지 않으면 'error' 이벤트가 API 프로세스를 죽인다).
        child.stdin.on('error', () => { /* 종료 코드로 판정 */ });
        if (opts.input !== undefined) { child.stdin.write(opts.input); }
        child.stdin.end();
    });
}

/**
 * 단일 task 의 영속 샌드박스. create() → exec()/파일 I/O 반복 → cleanup().
 * 파일 I/O 는 bind-mount 된 호스트 workdir 에 직접 수행(빠르고 docker cp 불요).
 * TaskExecutor 의 Docker 구현체 (D0 — 원격 실행기는 D1 에서 같은 계약으로 추가).
 */
export class TaskSandbox implements TaskExecutor {
    readonly taskId: string;
    readonly containerName: string;
    readonly hostWorkdir: string;
    private readonly cfg: TaskSandboxConfig;
    private created = false;
    /** 실행 중인 exec — abortRunning 이 중단시킨다. */
    private readonly running = new Set<AbortController>();

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
        // 동시 실행 상한 — 실행 중인 omk-task-* 컨테이너 수가 ground truth (재시작에도 정확).
        // 초과 시 throw → AgentTaskService 가 샌드박스 없이 graceful degrade 로 진행.
        const ps = await runProcess(this.cfg.dockerPath,
            ['ps', '-q', '--filter', `name=${CONTAINER_PREFIX}`], { timeoutMs: 10_000, outputCap: 65536 });
        const active = ps.stdout.split('\n').filter(Boolean).length;
        if (active >= this.cfg.maxConcurrent) {
            throw new Error(`동시 task 샌드박스 상한 도달 (${active}/${this.cfg.maxConcurrent})`);
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
        // 디스크 쿼터 — 컨테이너 내부 쓰기(bash 등)는 가로챌 수 없으므로 각 실행 직전 검사하는
        // best-effort: 초과 상태면 새 명령을 거부해 LLM 이 파일 정리 후 계속하도록 유도한다.
        if (await this.isOverQuota()) {
            return {
                stdout: '',
                stderr: `workspace 디스크 쿼터 초과(상한 ${Math.round(this.cfg.workspaceQuota / 1024 / 1024)}MB) — 불필요한 파일을 삭제(file_ops delete)한 후 다시 시도하세요.`,
                exitCode: -1, truncated: false, timedOut: false, durationMs: 0,
            };
        }
        const execId = randomUUID();
        const ac = new AbortController();
        this.running.add(ac);
        try {
            return await runProcess(
                this.cfg.dockerPath,
                ['exec', '-e', `${EXEC_ID_ENV}=${execId}`, this.containerName, 'sh', '-c', command],
                {
                    timeoutMs: this.cfg.execTimeoutMs, outputCap: this.cfg.outputCap, signal: ac.signal,
                    onStop: () => runProcess(this.cfg.dockerPath, buildKillExecArgs(this.containerName, execId), { timeoutMs: 10_000, outputCap: 4096 }),
                },
            );
        } finally { this.running.delete(ac); }
    }

    /** TaskExecutor.abortRunning — 실행 중인 명령을 타임아웃을 기다리지 않고 끝낸다(작업 취소). */
    abortRunning(): void {
        for (const ac of this.running) ac.abort();
    }

    /** workspace 사용량이 쿼터를 넘었는지 (쿼터+1 에서 조기 중단하는 walk). */
    private async isOverQuota(): Promise<boolean> {
        const size = await dirSizeBytes(this.hostWorkdir, this.cfg.workspaceQuota + 1);
        return size > this.cfg.workspaceQuota;
    }

    /** TaskExecutor.label — 관측/영속용 식별 라벨 = 컨테이너명. */
    get label(): string { return this.containerName; }

    /** TaskExecutor.localWorkdir — docker 는 bind-mount 라 호스트 workspace 가 항상 존재. */
    get localWorkdir(): string { return this.hostWorkdir; }

    /** 브라우저 도구 활성 여부. */
    get isBrowserEnabled(): boolean { return this.cfg.browserEnabled; }

    /**
     * 세션 지속(#2 Part A) ON 이면 storageState 파일명, OFF 면 null.
     * 사용자가 브라우저를 넘겨받아 남긴 상태 파일이 있으면 설정이 꺼져 있어도 이어받는다 — 그러려고 넘겨받은 것이다.
     */
    get browserStatePath(): string | null {
        return this.cfg.browserPersist || existsSync(join(this.hostWorkdir, BROWSER_SESSION.STATE_FILE)) ? BROWSER_SESSION.STATE_FILE : null;
    }

    /**
     * 브라우저 액션을 별도 일회성 컨테이너(browserNetwork)에서 실행 — 메인 컨테이너(network none)와
     * 분리해 bash/python 인터넷 미접근 보장. workspace 공유(스크린샷 저장). actionsRelPath 는 사전에 쓰여 있어야 함.
     */
    async runBrowser(actionsRelPath: string): Promise<ExecResult> {
        this.assertCreated();
        // 사용자가 넘겨받은 동안에는 실행하지 않는다 — 같은 상태 파일을 두 브라우저가 쓰면 돌려줄 때 덮어쓴다.
        const { isBrowserSessionActive, BROWSER_SESSION_BUSY_MESSAGE } = await import('./browser-session');
        if (await isBrowserSessionActive(this.taskId, this.cfg)) {
            return { stdout: '', stderr: BROWSER_SESSION_BUSY_MESSAGE, exitCode: -1, truncated: false, timedOut: false, durationMs: 0 };
        }
        // egress 프록시 ON: internal 망 + 프록시 보장 후 그 URL 을 브라우저에 주입.
        let proxyUrl: string | undefined;
        if (this.cfg.egressProxyEnabled) {
            const { ensureEgressProxy } = await import('./egress-proxy');
            proxyUrl = await ensureEgressProxy(this.cfg);
        }
        const name = browserRunContainerName(this.taskId);
        const args = buildBrowserRunArgs(this.hostWorkdir, actionsRelPath, this.cfg, proxyUrl, name);
        return runProcess(this.cfg.dockerPath, args, {
            timeoutMs: Math.max(this.cfg.execTimeoutMs, BROWSER_RUN.MIN_TIMEOUT_MS),
            outputCap: this.cfg.outputCap,
            // 시간 초과 — CLI 만 죽이면 컨테이너(chromium)는 계속 돈다. 이름으로 컨테이너까지 지운다.
            onStop: () => runProcess(this.cfg.dockerPath, ['rm', '-f', name], { timeoutMs: 10_000, outputCap: 4096 }),
        });
    }

    /** workspace 내 파일 쓰기 (호스트 bind-mount 직접). 경로 가드(어휘+실경로) + 디스크 쿼터 적용.
     *  Buffer 입력은 바이너리 그대로 기록(입력 첨부 원본 주입용). */
    async writeFile(relPath: string, content: string | Buffer): Promise<void> {
        const abs = await safeRealWorkspacePath(this.hostWorkdir, relPath);
        const size = await dirSizeBytes(this.hostWorkdir, this.cfg.workspaceQuota + 1);
        if (size + Buffer.byteLength(content) > this.cfg.workspaceQuota) {
            throw new Error(`workspace 디스크 쿼터 초과(상한 ${Math.round(this.cfg.workspaceQuota / 1024 / 1024)}MB) — 불필요한 파일을 삭제한 후 다시 시도하세요.`);
        }
        if (this.created && this.cfg.writeViaContainer) {
            // 컨테이너 안에서 쓴다 — 호스트가 쓰면 컨테이너가 약 1초 동안 예전 크기로 읽는다(Colima virtiofs).
            // 경로 검사는 위에서 호스트 실경로로 마쳤다. 여기서는 같은 파일의 컨테이너 쪽 경로만 만든다.
            const rel = relative(await realpath(resolve(this.hostWorkdir)), abs).split(sep).join('/');
            const r = await runProcess(this.cfg.dockerPath, buildWriteArgs(this.containerName, `${WORKSPACE}/${rel}`),
                { timeoutMs: this.cfg.execTimeoutMs, outputCap: 4096, input: content });
            if (r.exitCode === 0) return;
            logger.warn(`[${this.taskId}] 컨테이너 쓰기 실패 → 호스트에서 씁니다 (${relPath}): ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
        }
        await mkdir(dirname(abs), { recursive: true });
        await fsWriteFile(abs, content);
    }

    /** 호스트 파일을 workspace 로 복사 (대용량 입력 첨부 — Buffer 메모리 적재 없이 fs copy).
     *  경로 가드 + 디스크 쿼터는 writeFile 과 동일하게 적용. */
    async importFile(relPath: string, srcAbsPath: string): Promise<void> {
        const abs = await safeRealWorkspacePath(this.hostWorkdir, relPath);
        const st = await stat(srcAbsPath);
        const size = await dirSizeBytes(this.hostWorkdir, this.cfg.workspaceQuota + 1);
        if (size + st.size > this.cfg.workspaceQuota) {
            throw new Error(`workspace 디스크 쿼터 초과(상한 ${Math.round(this.cfg.workspaceQuota / 1024 / 1024)}MB) — 파일이 너무 큽니다.`);
        }
        await mkdir(dirname(abs), { recursive: true });
        await fsCopyFile(srcAbsPath, abs);
    }

    /** workspace 내 파일 읽기. 경로 가드(어휘+실경로) 적용. */
    async readFile(relPath: string): Promise<string> {
        const abs = await safeRealWorkspacePath(this.hostWorkdir, relPath);
        return fsReadFile(abs, 'utf8');
    }

    /** workspace 내 디렉토리 목록. 경로 가드(어휘+실경로) 적용. */
    async listDir(relPath = '.'): Promise<string[]> {
        const abs = await safeRealWorkspacePath(this.hostWorkdir, relPath);
        // 디렉토리는 이름 뒤에 '/' — 이름만 주면 모델이 폴더를 파일로 오인해 read 하다
        // EISDIR 로 실패하고 하위 파일에 영영 못 닿는다(2026-07-26 보고).
        const entries = await readdir(abs, { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
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
        // 작업 공간을 지울 때만 넘겨받은 브라우저 세션을 내린다(세션이 그 공간을 쓴다). 보존할 때는 두고 유휴 상한에 맡긴다 —
        // 승인 대기로 주차될 때도 이 정리가 도는데, 그때가 바로 사용자가 넘겨받아 조작하는 때다.
        if (removeWorkspace) {
            await import('./browser-session').then((m) => m.stopBrowserSession(this.taskId, this.cfg)).catch(() => { /* best-effort */ });
        }
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
 * 디렉토리 사용량(byte) 재귀 합산 — workspace 디스크 쿼터 검사용.
 * cap 초과가 확정되면 조기 중단한다(반환값은 "cap 이상" 판정에만 유효).
 * 심링크는 따라가지 않는다(Dirent 는 심링크를 file/dir 로 분류하지 않음).
 */
export async function dirSizeBytes(root: string, cap = Number.MAX_SAFE_INTEGER): Promise<number> {
    let total = 0;
    async function walk(dir: string): Promise<void> {
        if (total >= cap) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (total >= cap) return;
            const full = join(dir, e.name);
            if (e.isDirectory()) {
                await walk(full);
            } else if (e.isFile()) {
                try { total += (await stat(full)).size; } catch { /* 삭제 경합 등 — 무시 */ }
            }
        }
    }
    await walk(resolve(root));
    return total;
}

/**
 * 주어진 workspace 디렉토리의 전체 파일을 상대경로로 재귀 나열 (산출물 다운로드 엔드포인트용).
 * 라이브 TaskSandbox 인스턴스 없이도 동작(task 완료 후 workspace_path 로 호출).
 * **숨김 파일/디렉토리(dotfile) 제외** — `.git`(diff 캡처 메타), `.verify_*.py`(코드검증 임시),
 * 기타 시스템 dotfile 이 산출물 목록에 새어 "이상한 파일" 로 다운로드되던 것을 막는다.
 */
export async function listWorkspaceFilesAt(root: string, maxFiles = 1000): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
        if (out.length >= maxFiles) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (out.length >= maxFiles) return;
            if (e.name.startsWith('.')) continue; // 숨김 파일/디렉토리(.git·.verify_* 등) 제외
            const full = join(dir, e.name);
            if (e.isDirectory()) {
                await walk(full);
            } else {
                out.push(relative(root, full));
            }
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
 * 부팅 시 고아 task 컨테이너(omk-task-*)와 일회성 브라우저 컨테이너(omk-brun-*) 청소 — 비정상 종료로 남은 컨테이너 회수.
 */
export async function reapOrphanTaskSandboxes(cfg: TaskSandboxConfig = getTaskSandboxConfig()): Promise<number> {
    const ids: string[] = [];
    for (const prefix of [CONTAINER_PREFIX, BROWSER_RUN.CONTAINER_PREFIX]) {
        const list = await runProcess(cfg.dockerPath,
            ['ps', '-aq', '--filter', `name=${prefix}`], { timeoutMs: 10_000, outputCap: 65536 });
        ids.push(...list.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
    }
    for (const id of ids) {
        await runProcess(cfg.dockerPath, ['rm', '-f', id], { timeoutMs: 10_000, outputCap: 4096 });
    }
    if (ids.length) logger.info(`고아 task 샌드박스 ${ids.length}개 청소`);
    return ids.length;
}
