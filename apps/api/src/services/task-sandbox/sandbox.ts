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
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { mkdir, rm, writeFile as fsWriteFile, readFile as fsReadFile, readdir, stat, realpath, copyFile as fsCopyFile } from 'fs/promises';
import { resolve, sep, join, dirname, relative } from 'path';
import { getTaskSandboxConfig, BROWSER_SESSION, type TaskSandboxConfig } from '../../config/task-sandbox';
import { BROWSER_RUN } from '../../config/agent-task-browser-web';
import { BROWSER_TAKEOVER_DISCARDED_MESSAGE } from '../../prompts/agent-task-browser-web';
import { guardBrowserResult } from './browser-result-guard';
import type { TaskExecutor, ExecResult } from './executor';
import { wrapPipeline, readPipeStatus, PIPE_STATUS_TAG_PREFIX } from './pipe-status';
import { SANDBOX_WORKSPACE_DIR } from './workspace-path';
import { createLogger } from '../../utils/logger';
import { withLiveTerminal } from './live-terminal';
import { sanitizeId, buildRunArgs, buildBrowserRunArgs, browserRunContainerName, buildWriteArgs, EXEC_ID_ENV, buildKillExecArgs, runProcess } from './sandbox-docker-cli';
import { safeRealWorkspacePath, dirSizeBytes, listWorkspaceFilesAt } from './sandbox-workspace-fs';

// 기존 소비처(runtime/tools 등)가 './sandbox' 에서 ExecResult 를 import 하므로 재노출 유지.
export type { ExecResult } from './executor';
// docker 인자 조립·runProcess 와 workspace 경로 가드·나열은 max-lines 가드로 분리 — 기존 import 경로 유지용 재노출.
export { sanitizeId, buildRunArgs, buildBrowserRunArgs, browserRunContainerName, buildWriteArgs, buildKillExecArgs, runProcess } from './sandbox-docker-cli';
export { safeResolveWorkspacePath, safeRealWorkspacePath, dirSizeBytes, listWorkspaceFilesAt } from './sandbox-workspace-fs';

const logger = createLogger('TaskSandbox');

const CONTAINER_PREFIX = 'omk-task-';
const WORKSPACE = SANDBOX_WORKSPACE_DIR;

/**
 * 단일 task 의 영속 샌드박스. create() → exec()/파일 I/O 반복 → cleanup().
 * 파일 I/O 는 bind-mount 된 호스트 workdir 에 직접 수행(빠르고 docker cp 불요).
 * TaskExecutor 의 Docker 구현체 (D0 — 원격 실행기는 D1 에서 같은 계약으로 추가).
 */
/** 동시 샌드박스 상한에 걸려 만들지 못했다 — 일시적이라 호출부가 기다렸다 다시 시도한다. */
export class TaskSandboxCapacityError extends Error {
    constructor(readonly active: number, readonly max: number) {
        super(`동시 task 샌드박스 상한 도달 (${active}/${max})`);
        this.name = 'TaskSandboxCapacityError';
    }
}

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
        // 초과 시 throw → AgentTaskService 가 자리를 기다리고, 끝내 없으면 정책대로 처리(agent-task/sandbox-unavailable).
        const ps = await runProcess(this.cfg.dockerPath,
            ['ps', '-q', '--filter', `name=${CONTAINER_PREFIX}`], { timeoutMs: 10_000, outputCap: 65536 });
        const active = ps.stdout.split('\n').filter(Boolean).length;
        if (active >= this.cfg.maxConcurrent) {
            throw new TaskSandboxCapacityError(active, this.cfg.maxConcurrent);
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
    async exec(command: string, opts?: { pipeStatus?: boolean }): Promise<ExecResult> {
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
        // 파이프에 가려진 실패 — 감쌀 수 있는 파이프라인이면 앞 단계가 종료 코드를 적게 감싼다(아니면 null, 종전대로).
        const wrapped = opts?.pipeStatus ? wrapPipeline(command, `${PIPE_STATUS_TAG_PREFIX}${execId.slice(0, 8)}`) : null;
        const ac = new AbortController();
        this.running.add(ac);
        try {
            // 실행 중 출력 끝부분을 작업 폴더 숨김 파일로 남긴다(실시간 작업 화면, fail-open). bash 도구 경로(pipeStatus)만 —
            // 내부 도구 실행(검색·문법 검사)은 덮어쓰지 않는다. 쿼터 초과 분기는 기록하지 않는다.
            const r = await withLiveTerminal(this.hostWorkdir, opts?.pipeStatus ? { command, hideTag: wrapped?.tag } : null, (onOutput) => runProcess(
                this.cfg.dockerPath,
                ['exec', '-e', `${EXEC_ID_ENV}=${execId}`, this.containerName, 'sh', '-c', wrapped?.command ?? command],
                {
                    timeoutMs: this.cfg.execTimeoutMs, outputCap: this.cfg.outputCap, signal: ac.signal, onOutput,
                    onStop: () => runProcess(this.cfg.dockerPath, buildKillExecArgs(this.containerName, execId), { timeoutMs: 10_000, outputCap: 4096 }),
                },
            ));
            return wrapped ? readPipeStatus(r, wrapped) : r;
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
        const r = await runProcess(this.cfg.dockerPath, args, {
            timeoutMs: Math.max(this.cfg.execTimeoutMs, BROWSER_RUN.MIN_TIMEOUT_MS),
            outputCap: this.cfg.outputCap,
            // 시간 초과 — CLI 만 죽이면 컨테이너(chromium)는 계속 돈다. 이름으로 컨테이너까지 지운다.
            onStop: () => runProcess(this.cfg.dockerPath, ['rm', '-f', name], { timeoutMs: 10_000, outputCap: 4096 }),
        });
        // 실행 중에 사용자가 넘겨받았으면 결과를 버린다 — 시작 전 확인만으로는 그 사이의 넘겨받기를 놓친다.
        if (BROWSER_RUN.TAKEOVER_RECHECK_ENABLED && await isBrowserSessionActive(this.taskId, this.cfg)) {
            return { ...r, stdout: '', stderr: BROWSER_TAKEOVER_DISCARDED_MESSAGE, exitCode: -1 };
        }
        return guardBrowserResult(r);
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
    async listWorkspaceFiles(strict = false): Promise<string[]> {
        return listWorkspaceFilesAt(this.hostWorkdir, undefined, strict);
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
