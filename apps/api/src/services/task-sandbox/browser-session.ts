/**
 * ============================================================
 * 브라우저 넘겨받기(Take control) — 사용자가 에이전트의 브라우저를 직접 조작한다
 * ============================================================
 *
 * 에이전트의 browser 도구는 호출마다 새 컨테이너에서 뜨고 로그인 상태만 파일로 잇는다. 로그인·CAPTCHA 처럼
 * 사람이 해야 하는 단계에서 막히면 사용자가 같은 상태 파일로 세션 컨테이너를 띄워 직접 조작하고, 돌려주면
 * 상태를 파일에 저장한다 — 에이전트의 다음 browser 호출이 그 상태로 시작한다.
 *
 * 세션의 유무는 컨테이너가 ground truth 다(API 프로세스 메모리에 두지 않는다 — 워커가 여럿이어도 같다).
 * 명령은 `docker exec` 로 컨테이너 안 루프백에만 보낸다. 호스트로 포트를 열지 않으므로 internal 망(egress 프록시)
 * 에서도 같은 방식으로 동작한다.
 *
 * @module services/task-sandbox/browser-session
 */
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { getTaskSandboxConfig, BROWSER_SESSION, BROWSER_URL_GUARD_ENABLED, browserDestGuardEnv, type TaskSandboxConfig } from '../../config/task-sandbox';
import { validateOutboundUrl } from '../../security/ssrf-guard';
import { runProcess, sanitizeId } from './sandbox';
import { SANDBOX_WORKSPACE_DIR } from './workspace-path';
import { BROWSER_SESSION_SCRIPT } from './browser-session-script';
import { createLogger } from '../../utils/logger';

export { BROWSER_SESSION_SCRIPT };

const logger = createLogger('BrowserSession');

const CONTAINER_PREFIX = 'omk-browser-';
const DOCKER_SHORT_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 500;

/** 에이전트의 browser 호출이 넘겨받은 동안 받는 안내. */
export const BROWSER_SESSION_BUSY_MESSAGE =
    '사용자가 지금 브라우저를 직접 조작하고 있습니다(넘겨받기). 브라우저를 쓰지 않는 다른 일을 먼저 하거나, '
    + 'ask_human 으로 사용자에게 조작이 끝났는지 물은 뒤 다시 시도하세요.';

const httpUrl = z.string().max(2048).refine((u) => {
    try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; }
}, 'http(s) 주소만 열 수 있습니다');

/** 사용자 입력 — 좌표는 화면 안, 주소는 http(s), 키는 Playwright 키 이름(조합은 +). 화면 읽기·종료는 전용 라우트로만. */
export const browserSessionInputSchema = z.discriminatedUnion('op', [
    z.object({
        op: z.literal('click'),
        x: z.number().min(0).max(BROWSER_SESSION.VIEWPORT.width),
        y: z.number().min(0).max(BROWSER_SESSION.VIEWPORT.height),
    }),
    z.object({ op: z.literal('type'), text: z.string().min(1).max(BROWSER_SESSION.TEXT_MAX) }),
    z.object({ op: z.literal('key'), key: z.string().regex(/^[A-Za-z0-9]+(\+[A-Za-z0-9]+){0,3}$/).max(40) }),
    z.object({ op: z.literal('scroll'), dy: z.number().min(-BROWSER_SESSION.SCROLL_MAX).max(BROWSER_SESSION.SCROLL_MAX) }),
    z.object({ op: z.literal('goto'), url: httpUrl }),
    z.object({ op: z.literal('back') }),
]);
export type BrowserSessionInput = z.infer<typeof browserSessionInputSchema>;

export const browserSessionStartSchema = z.object({ url: httpUrl.optional() });

/**
 * 넘겨받은 브라우저가 가면 안 되는 주소인가(내부망·루프백·메타데이터) — 에이전트의 browser 도구와 같은 기준·같은 스위치
 * (browser-url-guard). 사용자가 직접 조작한다고 서버 쪽 망에 더 넓게 닿아서는 안 된다.
 * 여기서는 이동하려는 주소만 본다 — 리다이렉트·하위 요청은 컨테이너 안 검사 프록시가 막는다(세션 스크립트).
 */
export async function isBlockedSessionUrl(
    url: string, validate: (url: string) => Promise<unknown> = (u) => validateOutboundUrl(u),
): Promise<boolean> {
    if (!BROWSER_URL_GUARD_ENABLED) return false;
    try { await validate(url); return false; } catch { return true; }
}

/**
 * PURE: 에이전트가 browser 도구로 마지막에 연 주소(goto) — 넘겨받을 때 그 화면에서 시작하게 한다.
 * 스텝은 시간순. http(s) 가 아니거나 없으면 undefined.
 */
export function lastBrowserUrl(steps: Array<{ tool_name?: string | null; tool_args?: unknown }>): string | undefined {
    for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].tool_name !== 'browser') continue;
        const actions = (steps[i].tool_args as { actions?: unknown } | null | undefined)?.actions;
        if (!Array.isArray(actions)) continue;
        for (let j = actions.length - 1; j >= 0; j--) {
            const a = actions[j] as { type?: unknown; url?: unknown } | null;
            if (a?.type === 'goto' && httpUrl.safeParse(a.url).success) return a.url as string;
        }
    }
    return undefined;
}

export interface BrowserSessionReply {
    ok: boolean;
    error?: string;
    /** shot — JPEG(base64) */
    image?: string;
    url?: string;
    title?: string;
}

export function browserSessionContainerName(taskId: string): string {
    return `${CONTAINER_PREFIX}${sanitizeId(taskId)}`;
}

/**
 * PURE: 세션 컨테이너 `docker run -d --rm` 인자 (유닛테스트 대상).
 * 격리 플래그·네트워크는 에이전트 브라우저(buildBrowserRunArgs)와 같다 — 사용자가 넘겨받았다고 더 넓어지지 않는다.
 */
export function buildBrowserSessionRunArgs(
    containerName: string,
    hostWorkdir: string,
    cfg: TaskSandboxConfig,
    opts: { proxyUrl?: string; startUrl?: string },
): string[] {
    const a: string[] = ['run', '-d', '--rm', '--init', '--name', containerName];
    a.push('--network', opts.proxyUrl ? cfg.egressNetwork : (cfg.browserNetwork || 'bridge'));
    a.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges');
    a.push('--pids-limit', String(cfg.pidsLimit), '--memory', cfg.memory, '--memory-swap', cfg.memory, '--cpus', cfg.cpus);
    a.push('--user', cfg.user);
    a.push('--read-only', '--tmpfs', '/tmp:rw,exec', '--tmpfs', '/run:rw');
    a.push('-v', `${hostWorkdir}:${SANDBOX_WORKSPACE_DIR}:rw`);
    a.push('-w', SANDBOX_WORKSPACE_DIR);
    a.push('-e', `OMK_IDLE_MS=${BROWSER_SESSION.IDLE_MS}`);
    a.push('-e', `OMK_STATE_FILE=${BROWSER_SESSION.STATE_FILE}`);
    a.push('-e', `OMK_PORT=${BROWSER_SESSION.PORT}`);
    a.push('-e', `OMK_VIEW_W=${BROWSER_SESSION.VIEWPORT.width}`, '-e', `OMK_VIEW_H=${BROWSER_SESSION.VIEWPORT.height}`);
    a.push('-e', `OMK_JPEG_QUALITY=${BROWSER_SESSION.JPEG_QUALITY}`);
    if (opts.proxyUrl) a.push('-e', `BROWSER_PROXY=${opts.proxyUrl}`);
    // 프록시가 없는 배포 — 세션 스크립트가 컨테이너 안 검사 프록시를 띄울 때 쓰는 설정(에이전트 브라우저와 같은 값).
    else for (const e of browserDestGuardEnv()) a.push('-e', e);
    if (opts.startUrl) a.push('-e', `OMK_START_URL=${opts.startUrl}`);
    a.push(cfg.image, 'node', `${SANDBOX_WORKSPACE_DIR}/${BROWSER_SESSION.SCRIPT_FILE}`);
    return a;
}

/** PURE: 세션에 명령 하나를 보내는 `docker exec` 인자 (유닛테스트 대상). 본문(JSON)은 stdin 으로 넘긴다. */
export function buildBrowserSessionExecArgs(containerName: string): string[] {
    return [
        'exec', '-i', containerName, 'curl', '-s', '--noproxy', '*',
        '--max-time', String(Math.floor(BROWSER_SESSION.COMMAND_TIMEOUT_MS / 1000) - 2),
        '-H', 'content-type: application/json', '--data-binary', '@-',
        `http://127.0.0.1:${BROWSER_SESSION.PORT}/cmd`,
    ];
}

/** 이 작업의 브라우저를 사용자가 넘겨받은 상태인가 — 세션 컨테이너가 돌고 있는지로 판정한다. */
export async function isBrowserSessionActive(taskId: string, cfg: TaskSandboxConfig = getTaskSandboxConfig()): Promise<boolean> {
    const r = await runProcess(cfg.dockerPath, ['inspect', '-f', '{{.State.Running}}', browserSessionContainerName(taskId)],
        { timeoutMs: DOCKER_SHORT_TIMEOUT_MS, outputCap: 4096 });
    return r.exitCode === 0 && r.stdout.trim() === 'true';
}

/** 세션에 명령 하나를 보내고 응답을 받는다. 세션이 없거나 응답이 깨지면 ok:false. */
export async function sendBrowserSessionCommand(
    taskId: string,
    command: BrowserSessionInput | { op: 'ping' | 'shot' | 'close' },
    cfg: TaskSandboxConfig = getTaskSandboxConfig(),
): Promise<BrowserSessionReply> {
    const r = await runProcess(cfg.dockerPath, buildBrowserSessionExecArgs(browserSessionContainerName(taskId)), {
        timeoutMs: BROWSER_SESSION.COMMAND_TIMEOUT_MS, outputCap: BROWSER_SESSION.OUTPUT_CAP, input: JSON.stringify(command),
    });
    if (r.exitCode !== 0 || !r.stdout) return { ok: false, error: 'session_unavailable' };
    try {
        return JSON.parse(r.stdout) as BrowserSessionReply;
    } catch {
        return { ok: false, error: 'bad_reply' };
    }
}

/**
 * 세션 시작. 이미 돌고 있으면 그대로 둔다(멱등 — 다른 창에서 다시 눌러도 조작 중인 화면이 유지된다).
 * 실패하면 컨테이너를 치우고 throw.
 */
export async function startBrowserSession(
    taskId: string,
    hostWorkdir: string,
    opts: { startUrl?: string } = {},
    cfg: TaskSandboxConfig = getTaskSandboxConfig(),
): Promise<void> {
    if (await isBrowserSessionActive(taskId, cfg)) return;
    const name = browserSessionContainerName(taskId);
    await writeFile(join(hostWorkdir, BROWSER_SESSION.SCRIPT_FILE), BROWSER_SESSION_SCRIPT);
    let proxyUrl: string | undefined;
    if (cfg.egressProxyEnabled) {
        const { ensureEgressProxy } = await import('./egress-proxy');
        proxyUrl = await ensureEgressProxy(cfg);
    }
    await runProcess(cfg.dockerPath, ['rm', '-f', name], { timeoutMs: DOCKER_SHORT_TIMEOUT_MS, outputCap: 4096 });
    const run = await runProcess(cfg.dockerPath, buildBrowserSessionRunArgs(name, hostWorkdir, cfg, { proxyUrl, startUrl: opts.startUrl }),
        { timeoutMs: BROWSER_SESSION.READY_TIMEOUT_MS, outputCap: 8192 });
    if (run.exitCode !== 0) throw new Error(`브라우저 세션 시작 실패: ${(run.stderr || run.stdout).trim().slice(0, 300)}`);

    const deadline = Date.now() + BROWSER_SESSION.READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if ((await sendBrowserSessionCommand(taskId, { op: 'ping' }, cfg)).ok) {
            logger.info(`[${taskId}] 브라우저 세션 시작 (${name})`);
            return;
        }
        // 스크립트가 바로 죽었으면(--rm 으로 컨테이너도 사라진다) 끝까지 기다리지 않는다
        if (!(await isBrowserSessionActive(taskId, cfg))) break;
        await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
    await runProcess(cfg.dockerPath, ['rm', '-f', name], { timeoutMs: DOCKER_SHORT_TIMEOUT_MS, outputCap: 4096 });
    throw new Error('브라우저 세션이 준비되지 않았습니다');
}

/**
 * 세션 종료(돌려주기). close 명령으로 로그인 상태를 저장하게 한 뒤 컨테이너가 내려가기를 기다린다.
 * 응답이 없으면 `docker stop`(SIGTERM — 스크립트가 저장 후 종료) → 그래도 남으면 강제 삭제. 멱등.
 */
export async function stopBrowserSession(taskId: string, cfg: TaskSandboxConfig = getTaskSandboxConfig()): Promise<void> {
    if (!(await isBrowserSessionActive(taskId, cfg))) return;
    const name = browserSessionContainerName(taskId);
    const closed = await sendBrowserSessionCommand(taskId, { op: 'close' }, cfg);
    if (closed.ok) {
        const deadline = Date.now() + DOCKER_SHORT_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (!(await isBrowserSessionActive(taskId, cfg))) { logger.info(`[${taskId}] 브라우저 세션 종료`); return; }
            await new Promise((r) => setTimeout(r, READY_POLL_MS));
        }
    }
    await runProcess(cfg.dockerPath, ['stop', '-t', '10', name], { timeoutMs: 20_000, outputCap: 4096 });
    await runProcess(cfg.dockerPath, ['rm', '-f', name], { timeoutMs: DOCKER_SHORT_TIMEOUT_MS, outputCap: 4096 });
    logger.info(`[${taskId}] 브라우저 세션 종료(강제)`);
}
