/**
 * ============================================================
 * MCP Sandbox — playwright 브라우저 사전 설치 래핑
 * ============================================================
 *
 * playwright 를 사용하는 uvx 서버(noapi-google-search-mcp 등)는 스폰할 때마다 최신 playwright 를
 * 받는데, 브라우저 본체는 서버별 캐시 볼륨(~/.cache/ms-playwright)에 옛 리비전만 남아 launch 가
 * "Executable doesn't exist" 로 죽는다(2026-10-15 운영 실측: 하루에 chromium v1243 → v1248).
 * 그래서 서버 실행 전에 같은 컨테이너·같은 venv 로 `python -m playwright install <브라우저>` 를 먼저
 * 돌린다. 이미 설치돼 있으면 playwright 가 곧바로 지나간다.
 *
 * ⚠️ stdout 은 MCP JSON-RPC 통로다 — 설치 출력은 stderr 로, stdin 은 /dev/null 로 막는다.
 *
 * @module mcp/sandbox-playwright
 */

/** 이름만으로 브라우저 사전 설치 대상으로 판정하는 패키지. */
export const PLAYWRIGHT_UVX_PACKAGES: readonly string[] = ['noapi-google-search-mcp'];
export const PLAYWRIGHT_NPX_PACKAGES: readonly string[] = ['@playwright/mcp'];

/** 서버 env opt-in 키 — 값은 설치할 브라우저 목록(쉼표/공백 구분, 예: `chromium`). */
export const PLAYWRIGHT_BROWSERS_ENV_KEY = 'OMK_PLAYWRIGHT_BROWSERS';

/** 값을 받는 uvx 옵션 — 이 뒤의 토큰은 패키지 스펙이 아니다. */
const UVX_VALUE_OPTIONS = new Set([
    '--with', '--with-editable', '--with-requirements', '--from', '--python', '-p', '-w',
    '--index', '--index-url', '-i', '--extra-index-url', '--default-index', '--find-links', '-f',
]);

interface PlaywrightInput {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

/** 패키지 스펙(`pkg==1.0`, `pkg[extra]>=1`)에서 이름만. */
function packageName(spec: string): string {
    return spec.split(/[=<>!~[;@ ]/)[0] ?? '';
}

/** env opt-in 값 → 브라우저 이름 목록(안전한 이름만). */
export function playwrightBrowsersFromEnv(env?: Record<string, string>): string[] {
    const raw = env?.[PLAYWRIGHT_BROWSERS_ENV_KEY];
    if (!raw) return [];
    return String(raw).split(/[\s,]+/).filter((b) => /^[A-Za-z0-9_-]+$/.test(b));
}

/** PURE: 스폰 전 playwright 브라우저 설치가 필요한 MCP 서버인지. */
export function needsPlaywrightBrowser(input: PlaywrightInput): boolean {
    if (input.command === 'npx') {
        return input.args.some((a) => PLAYWRIGHT_NPX_PACKAGES.some((name) => String(a) === name || String(a).startsWith(`${name}@`)));
    }
    if (input.command !== 'uvx') return false;
    if (playwrightBrowsersFromEnv(input.env).length > 0) return true;
    return input.args.some((a) => PLAYWRIGHT_UVX_PACKAGES.includes(packageName(String(a))));
}

/** PURE: POSIX sh 단일 인용 (`'` → `'\''`). */
export function shellQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * PURE: uvx/npx 호출을 브라우저 사전 설치 후 원래 MCP 서버 실행으로 감싼다.
 * 설치 실패는 서버 기동을 막지 않는다(종전처럼 도구 오류로 드러난다).
 */
export function wrapWithPlaywrightInstall(command: string, args: string[], browsers: string[] = ['chromium']): string[] {
    if (command === 'npx') {
        const packageIndex = args.findIndex((a) => PLAYWRIGHT_NPX_PACKAGES.some((name) => String(a) === name || String(a).startsWith(`${name}@`)));
        if (packageIndex < 0) return [command, ...args];
        const npxPackage = args.slice(0, packageIndex + 1).map(String);
        const serverArgs = args.map(String);
        if (!serverArgs.includes('--isolated')) serverArgs.push('--isolated');
        const q = (xs: string[]): string => xs.map(shellQuote).join(' ');
        const install = `${q([command, ...npxPackage, 'install-browser', 'chrome-for-testing'])} </dev/null >&2 || true`;
        return ['sh', '-c', `${install}; exec ${q([command, ...serverArgs])}`];
    }

    // uvx 옵션(값 포함)과 첫 위치 인자(패키지 스펙 또는 --from 이 있을 때의 실행 이름)를 가른다.
    const opts: string[] = [];
    let fromSpec: string | undefined;
    let positional: string | undefined;
    for (let i = 0; i < args.length; i++) {
        const t = String(args[i]);
        if (t === '--from') {
            fromSpec = args[++i];
        } else if (t.startsWith('--from=')) {
            fromSpec = t.slice('--from='.length);
        } else if (UVX_VALUE_OPTIONS.has(t)) {
            opts.push(t, String(args[++i]));
        } else if (t.startsWith('-')) {
            opts.push(t);
        } else {
            positional = t;
            break;
        }
    }
    const spec = fromSpec ?? positional ?? '';
    const q = (xs: string[]): string => xs.map(shellQuote).join(' ');
    const install = `${q([command, ...opts, '--from', spec])} python -m playwright install ${q(browsers)} </dev/null >&2 || true`;
    return ['sh', '-c', `${install}; exec ${q([command, ...args.map(String)])}`];
}
