/**
 * Task Sandbox docker CLI 조립·실행 — sandbox.ts 에서 분리 (max-lines 가드).
 * 컨테이너 이름 안전화·docker run/exec 인자 조립(PURE)·자식 프로세스 실행(runProcess).
 *
 * @module services/task-sandbox/sandbox-docker-cli
 */
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { browserDestGuardEnv, type TaskSandboxConfig } from '../../config/task-sandbox';
import { BROWSER_RUN } from '../../config/agent-task-browser-web';
import type { ExecResult } from './executor';
import { SANDBOX_WORKSPACE_DIR } from './workspace-path';
import { tapOutput } from './live-terminal';

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
    /** 러너의 목적지 검사 설정(`KEY=값`). */
    guardEnv: readonly string[] = browserDestGuardEnv(),
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
    for (const kv of guardEnv) a.push('-e', kv);
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

/** exec 한 번을 식별하는 환경변수 — 그 명령이 띄운 프로세스(백그라운드·데몬 포함)가 모두 물려받는다. */
export const EXEC_ID_ENV = 'OMK_EXEC_ID';

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
    /** signal·onStop — 타임아웃/중단으로 끝낼 때 CLI 를 죽이기 전에 onStop 으로 컨테이너 안 프로세스를 정리한다.
     *  onOutput — stdout·stderr 조각마다 출력 상한과 무관하게 부른다(실시간 기록용, 예외는 삼킨다 — tapOutput). */
    opts: { timeoutMs: number; outputCap: number; input?: string | Buffer; signal?: AbortSignal; onStop?: () => Promise<unknown>; onOutput?: (chunk: string, stream: 'out' | 'err') => void },
): Promise<ExecResult> {
    return new Promise((resolvePromise) => {
        const started = Date.now();
        const child = tapOutput(spawn(dockerPath, args, { stdio: ['pipe', 'pipe', 'pipe'] }), opts.onOutput);
        let stdout = '';
        let stderr = '';
        let truncated = false, timedOut = false;

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
