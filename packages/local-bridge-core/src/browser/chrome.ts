/**
 * 전용 프로필 Chrome 기동 — 디버깅 포트는 OS 가 고르게(0) 하고 프로필 디렉토리의 `DevToolsActivePort` 로 읽는다.
 * 포트는 루프백에만 열린다(Chrome 기본). 사용자의 평소 프로필은 건드리지 않는다 — Chrome 136 부터 기본 프로필에는
 * 디버깅 포트를 열 수 없고, 평소 로그인 정보를 에이전트에 그대로 넘기지 않으려는 뜻이기도 하다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { BROWSER_HEADLESS, BROWSER_LAUNCH_TIMEOUT_MS, BROWSER_POLL_MS, BROWSER_PROFILE_DIRECTORY } from '../constants';

/** 플랫폼별 Chromium 계열 실행 파일 후보 — 앞의 것부터 찾는다. */
function candidates(): string[] {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (process.platform === 'darwin') {
        return [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ];
    }
    if (process.platform === 'win32') {
        const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((r): r is string => !!r);
        return roots.flatMap((r) => [
            path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]);
    }
    return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
}

/** 쓸 수 있는 브라우저 실행 파일 — OMK_BRIDGE_CHROME 이 우선. 없으면 null. */
export function findChrome(): string | null {
    const override = process.env.OMK_BRIDGE_CHROME;
    if (override) return fs.existsSync(override) ? override : null;
    return candidates().find((p) => fs.existsSync(p)) ?? null;
}

const ACTIVE_PORT_FILE = 'DevToolsActivePort';

/** 프로필 디렉토리의 DevToolsActivePort → 브라우저 수준 WebSocket 주소. 파일이 없거나 형식이 다르면 null. */
export function readDevToolsEndpoint(profileDir: string): string | null {
    try {
        const [port, wsPath] = fs.readFileSync(path.join(profileDir, ACTIVE_PORT_FILE), 'utf8').split('\n').map((s) => s.trim());
        return /^\d+$/.test(port) && wsPath?.startsWith('/') ? `ws://127.0.0.1:${port}${wsPath}` : null;
    } catch { return null; }
}

export interface LaunchedChrome {
    wsUrl: string;
    /** 이 호출이 띄운 프로세스 — 정리할 때 끈다 */
    proc: ChildProcess;
}

/** 전용 프로필로 Chrome 을 띄우고 디버깅 주소가 준비될 때까지 기다린다. */
export async function launchChrome(profileDir: string, signal?: AbortSignal): Promise<LaunchedChrome> {
    const bin = findChrome();
    if (!bin) throw new Error('Chrome 을 찾지 못했습니다 — Google Chrome 을 설치하거나 OMK_BRIDGE_CHROME 에 실행 파일 경로를 지정하세요');
    fs.mkdirSync(profileDir, { recursive: true });
    // 지난 실행이 남긴 주소 파일은 지운다 — 새 프로세스가 쓴 값만 읽는다.
    fs.rmSync(path.join(profileDir, ACTIVE_PORT_FILE), { force: true });
    const proc = spawn(bin, [
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        // 기동 전에 Preferences 를 고친 프로필로 띄운다 — 없으면 Local State 의 마지막 사용 프로필로 뜬다(설계 B-9).
        `--profile-directory=${BROWSER_PROFILE_DIRECTORY}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...(BROWSER_HEADLESS ? ['--headless=new'] : []),
        'about:blank',
    ], { stdio: 'ignore', detached: false });
    let exited = false;
    proc.once('exit', () => { exited = true; });
    proc.once('error', () => { exited = true; });
    const deadline = Date.now() + BROWSER_LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        // 호출부가 기동을 그만뒀다(LocalBrowser.dispose) — 띄우던 자식을 끄고 그만둔다
        if (signal?.aborted) {
            try { proc.kill(); } catch { /* noop */ }
            throw new Error('Chrome 기동을 그만뒀습니다');
        }
        const wsUrl = readDevToolsEndpoint(profileDir);
        if (wsUrl) return { wsUrl, proc };
        if (exited) throw new Error('Chrome 이 시작 직후 종료됐습니다 — 같은 전용 프로필을 쓰는 Chrome 이 이미 떠 있을 수 있습니다');
        await new Promise((r) => setTimeout(r, BROWSER_POLL_MS));
    }
    try { proc.kill(); } catch { /* noop */ }
    throw new Error('Chrome 디버깅 포트가 열리지 않았습니다(시간 초과)');
}

/** 끝났는지 — POSIX 에서는 거둬지지 않은 좀비도 끝난 것으로 본다('exit' 훅에서는 이벤트 루프가 돌지 않아 자식을 거두지 않는다). */
function exitedSync(pid: number): boolean {
    try { process.kill(pid, 0); } catch { return true; }
    if (process.platform === 'win32') return false;
    const r = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    if (r.error) return true; // 알 수 없으면 기다리지 않는다
    const stat = r.stdout.trim();
    return stat === '' || stat.startsWith('Z');
}

/**
 * 띄운 Chrome 을 끄고 끝날 때까지(상한 `ms`) 동기로 기다린다 — 호스트 프로세스의 'exit' 훅에서 부른다.
 * 기다려야 호스트가 그 뒤에 놓는 자원(CLI 의 브라우저 주인 잠금)을 넘겨받은 쪽이 꺼지는 중인 Chrome 에 붙지 않는다.
 */
export function killAndWaitSync(proc: ChildProcess, ms: number): void {
    if (proc.exitCode !== null || proc.signalCode !== null || proc.pid === undefined) return;
    try { proc.kill(); } catch { return; }
    const pause = new Int32Array(new SharedArrayBuffer(4));
    const end = Date.now() + ms;
    while (!exitedSync(proc.pid) && Date.now() < end) Atomics.wait(pause, 0, 0, 20);
}
