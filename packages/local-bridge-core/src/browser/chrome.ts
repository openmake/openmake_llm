/**
 * 전용 프로필 Chrome 기동 — 디버깅 포트는 OS 가 고르게(0) 하고 프로필 디렉토리의 `DevToolsActivePort` 로 읽는다.
 * 포트는 루프백에만 열린다(Chrome 기본). 사용자의 평소 프로필은 건드리지 않는다 — Chrome 136 부터 기본 프로필에는
 * 디버깅 포트를 열 수 없고, 평소 로그인 정보를 에이전트에 그대로 넘기지 않으려는 뜻이기도 하다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { BROWSER_HEADLESS, BROWSER_LAUNCH_TIMEOUT_MS, BROWSER_POLL_MS } from '../constants';

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
export async function launchChrome(profileDir: string): Promise<LaunchedChrome> {
    const bin = findChrome();
    if (!bin) throw new Error('Chrome 을 찾지 못했습니다 — Google Chrome 을 설치하거나 OMK_BRIDGE_CHROME 에 실행 파일 경로를 지정하세요');
    fs.mkdirSync(profileDir, { recursive: true });
    // 지난 실행이 남긴 주소 파일은 지운다 — 새 프로세스가 쓴 값만 읽는다.
    fs.rmSync(path.join(profileDir, ACTIVE_PORT_FILE), { force: true });
    const proc = spawn(bin, [
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
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
        const wsUrl = readDevToolsEndpoint(profileDir);
        if (wsUrl) return { wsUrl, proc };
        if (exited) throw new Error('Chrome 이 시작 직후 종료됐습니다 — 같은 전용 프로필을 쓰는 Chrome 이 이미 떠 있을 수 있습니다');
        await new Promise((r) => setTimeout(r, BROWSER_POLL_MS));
    }
    try { proc.kill(); } catch { /* noop */ }
    throw new Error('Chrome 디버깅 포트가 열리지 않았습니다(시간 초과)');
}
