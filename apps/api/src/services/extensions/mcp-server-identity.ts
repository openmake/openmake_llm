/**
 * 확장 MCP 서버 식별 (§8-3) — 저장·spawn 할 연결 설정을 정책 비교용 식별자로 바꾼다(URL 정규화·실행기·패키지 해석).
 * 판정 규칙과 우회 차단 설명은 services/extensions/mcp-server-policy.ts 머리글.
 *
 * @module services/extensions/mcp-server-identity
 */
import {
    MCP_COMMAND_STRIP_EXTENSIONS,
    MCP_CONTAINER_DEFAULT_REGISTRY,
    MCP_FLOATING_VERSIONS,
    MCP_RUNNER_COMMANDS,
    MCP_RUNNER_FLAGS,
    MCP_SHELL_UNWRAP_MAX_DEPTH,
    MCP_SHELL_WRAPPERS,
    type McpRunnerFamily,
} from '../../config/extension-mcp-server-policy';

/** 검사 대상 — 저장 직전의 연결 설정(env 는 받지 않는다) */
export interface McpServerSpec {
    name?: string;
    transport?: string | null;
    command?: string | null;
    args?: readonly unknown[] | null;
    url?: string | null;
}

export interface PackageId { name: string; version?: string; wildcard?: boolean }

export interface Invocation {
    /** 소문자 + 확장자 제거, 경로 유지 */
    command: string;
    /** 경로를 뗀 이름 */
    base: string;
    family?: McpRunnerFamily;
    /** 대표 패키지(표시용) = pkgs[0] */
    pkg?: PackageId;
    /** 실행기가 설치·실행할 패키지 전부 — `-p` 여러 개·`--with` 추가 의존성까지. allow 는 전부 맞아야 한다 */
    pkgs: PackageId[];
    /** 실행기 하위 명령 뒤의 인자(소문자 아님, 원문) */
    tokens: string[];
}

export type McpServerDescriptor =
    | { kind: 'remote'; scheme: string; host: string; port: string; path: string; display: string }
    | { kind: 'stdio'; primary: Invocation; nested: Invocation[]; display: string }
    | { kind: 'unidentified'; display: string };


// ── 원격 URL ───────────────────────────────────────────────────────────────────

const UNRESERVED_PCT = /%([0-9A-Fa-f]{2})/g;

function decodeUnreserved(path: string): string {
    return path.replace(UNRESERVED_PCT, (m, hex: string) => {
        const ch = String.fromCharCode(parseInt(hex, 16));
        return /[A-Za-z0-9\-._~]/.test(ch) ? ch : m.toUpperCase();
    });
}

function normalizePath(pathname: string): string {
    let p = decodeUnreserved(pathname).replace(/\/{2,}/g, '/');
    while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p === '/' ? '' : p;
}

/** deny 용 경로 — 전부 해제 + 소문자 */
export function broadPath(path: string): string {
    let p = path;
    try { p = decodeURIComponent(path); } catch { /* 깨진 % 는 그대로 */ }
    return p.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
}

interface ParsedUrl { scheme: string; host: string; port: string; path: string }

function parseHttpUrl(raw: string): ParsedUrl | null {
    let u: URL;
    try { u = new URL(raw.trim()); } catch { return null; }
    const scheme = u.protocol.replace(/:$/, '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return null;
    const host = u.hostname.toLowerCase().replace(/\.+$/, '');
    if (!host) return null;
    return { scheme, host, port: u.port, path: normalizePath(u.pathname) };
}

/** PURE: 원격 MCP URL 정규화 — 식별 불가면 null */
export function normalizeMcpServerUrl(raw: string): string | null {
    const p = parseHttpUrl(raw);
    return p ? `${p.scheme}://${p.host}${p.port ? `:${p.port}` : ''}${p.path}` : null;
}

export interface UrlRuleShape { scheme: string; host: string; wildcard: boolean; port: string; path: string }

export function parseUrlRule(url: string): UrlRuleShape | null {
    const wildcard = /^https?:\/\/\*\./i.test(url.trim());
    const p = parseHttpUrl(wildcard ? url.trim().replace('://*.', '://') : url);
    return p ? { ...p, wildcard } : null;
}

export function hostMatches(rule: UrlRuleShape, host: string): boolean {
    return rule.wildcard ? host.endsWith(`.${rule.host}`) : host === rule.host;
}

export function pathPrefix(rulePath: string, path: string): boolean {
    return rulePath === '' || path === rulePath || path.startsWith(`${rulePath}/`);
}

// ── stdio 명령 ─────────────────────────────────────────────────────────────────

export function normalizeCommand(raw: string): { command: string; base: string } {
    const command = raw.trim().toLowerCase().replace(/\\/g, '/').replace(MCP_COMMAND_STRIP_EXTENSIONS, '');
    const base = command.slice(command.lastIndexOf('/') + 1);
    return { command, base };
}

export function familyOfBase(base: string): McpRunnerFamily | undefined {
    return MCP_RUNNER_COMMANDS[base]?.family;
}

/** 실행기 하위 명령을 뗀 나머지 인자 — 실행기가 아니면 null */
function runnerArgs(base: string, args: string[]): string[] | null {
    const entry = MCP_RUNNER_COMMANDS[base];
    if (!entry) return null;
    for (const sub of entry.subcommands) {
        if (sub.every((s, i) => (args[i] ?? '').toLowerCase() === s)) return args.slice(sub.length);
    }
    return null;
}

function stripVersionFloat(version: string | undefined): string | undefined {
    if (version === undefined || version === '') return undefined;
    return MCP_FLOATING_VERSIONS.includes(version.toLowerCase()) ? undefined : version;
}

/** PURE: 패키지 식별자 해석 — 계열별 정규화. 와일드카드(끝 `/*`)는 이름 접두로 */
export function parsePackageSpec(rawSpec: string, family: McpRunnerFamily | undefined): PackageId | null {
    let spec = rawSpec.trim();
    if (!spec || spec.startsWith('-')) return null;
    const wildcard = spec.endsWith('/*');
    if (wildcard) spec = `${spec.slice(0, -2)}/__wild__`;
    let out: PackageId | null;
    if (family === 'npm') {
        spec = spec.replace(/^npm:/i, '');
        const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
        const name = (at > 0 ? spec.slice(0, at) : spec).toLowerCase();
        out = name ? { name, ...(at > 0 && stripVersionFloat(spec.slice(at + 1)) ? { version: stripVersionFloat(spec.slice(at + 1)) } : {}) } : null;
    } else if (family === 'python') {
        // PyPI 이름엔 '/' 가 없다 — 와일드카드 불가
        const m = wildcard ? null : /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(?:(===|==|@)\s*([^\s;,]+)|[<>=!~].*)?$/.exec(spec);
        if (!m) return null;
        const name = m[1].toLowerCase().replace(/[-_.]+/g, '-');
        const version = m[3] ? stripVersionFloat(m[4]) : undefined;
        out = { name, ...(version ? { version } : {}) };
    } else if (family === 'container') {
        let ref = spec.toLowerCase();
        let version: string | undefined;
        const at = ref.indexOf('@');
        if (at >= 0) { version = ref.slice(at + 1); ref = ref.slice(0, at); }
        const slash = ref.lastIndexOf('/');
        const colon = ref.lastIndexOf(':');
        if (colon > slash) { const tag = ref.slice(colon + 1); ref = ref.slice(0, colon); version = version ?? stripVersionFloat(tag); }
        const parts = ref.split('/');
        const first = parts[0];
        const hasRegistry = parts.length > 1 && (first.includes('.') || first.includes(':') || first === 'localhost');
        let registry = hasRegistry ? first : MCP_CONTAINER_DEFAULT_REGISTRY.host;
        if ((MCP_CONTAINER_DEFAULT_REGISTRY.aliases as readonly string[]).includes(registry)) registry = MCP_CONTAINER_DEFAULT_REGISTRY.host;
        const rest = hasRegistry ? parts.slice(1) : parts;
        if (registry === MCP_CONTAINER_DEFAULT_REGISTRY.host && rest.length === 1) rest.unshift(MCP_CONTAINER_DEFAULT_REGISTRY.library);
        const name = [registry, ...rest].join('/');
        out = rest.length > 0 && rest.every(Boolean) ? { name, ...(version ? { version } : {}) } : null;
    } else {
        out = { name: spec.toLowerCase() };
    }
    if (out && wildcard) {
        if (!out.name.endsWith('/__wild__')) return null;
        return { name: out.name.slice(0, -'__wild__'.length), wildcard: true };
    }
    return out;
}

/**
 * 실행기 인자에서 패키지 — 패키지 플래그(`-p`·`--from`·`--spec`)가 있으면 그 값들(여러 개면 전부), 없으면 플래그 뒤 첫 위치 인자.
 * 추가 설치 플래그(`--with`)의 값도 덧붙인다(실행 전 설치되는 코드라 allow 대상).
 */
function extractPackages(family: McpRunnerFamily, args: string[]): PackageId[] {
    const { valueFlags, packageFlags, extraPackageFlags } = MCP_RUNNER_FLAGS[family];
    const fromFlags: PackageId[] = [];
    const extras: PackageId[] = [];
    let positional: string | undefined;
    for (let i = 0; i < args.length; i++) {
        const tok = args[i];
        if (tok === '--') { positional = args[i + 1]; break; }
        if (tok.startsWith('-')) {
            const eq = tok.indexOf('=');
            const flag = (eq > 0 ? tok.slice(0, eq) : tok).toLowerCase();
            const value = eq > 0 ? tok.slice(eq + 1) : (valueFlags.includes(flag) ? args[++i] : undefined);
            if (value && (packageFlags.includes(flag) || extraPackageFlags.includes(flag))) {
                // 쉼표로 여러 개를 받는 플래그(--with a,b) 대비
                for (const part of value.split(',')) {
                    const pkg = parsePackageSpec(part, family);
                    if (pkg) (packageFlags.includes(flag) ? fromFlags : extras).push(pkg);
                }
            }
            continue;
        }
        positional = tok;
        break;
    }
    const main = fromFlags.length > 0 ? fromFlags : (positional ? [parsePackageSpec(positional, family)].filter((x): x is PackageId => !!x) : []);
    return [...main, ...extras];
}

/** `env` 앞머리 걷기 — 남는 명령이 없으면 null */
function unwrapEnv(args: string[]): string[] | null {
    let i = 0;
    while (i < args.length) {
        const t = args[i];
        if (t === '-i' || t === '-' || t === '--ignore-environment' || t === '-0' || t === '--null') { i++; continue; }
        if (t === '-u' || t === '--unset') { i += 2; continue; }
        if (t.startsWith('--unset=') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
        if (t === '--') { i++; break; }
        break;
    }
    return i < args.length ? args.slice(i) : null;
}

/** 아주 단순한 셸 토큰화 — 따옴표 묶음 + `;`·`&&`·`||`·`|`·`&`·줄바꿈으로 명령 분리 */
function splitShellCommands(script: string): string[][] {
    const cmds: string[][] = [];
    let cur: string[] = [];
    let word = '';
    let inWord = false;
    const flushWord = () => { if (inWord) { cur.push(word); word = ''; inWord = false; } };
    const flushCmd = () => { flushWord(); if (cur.length) cmds.push(cur); cur = []; };
    for (let i = 0; i < script.length; i++) {
        const ch = script[i];
        if (ch === '"' || ch === "'") {
            // 큰따옴표 안의 명령 치환까지 보려면 그 안도 다시 쪼개야 한다 — 큰따옴표 묶음은 따로 셸 문자열로도 넘긴다
            const end = script.indexOf(ch, i + 1);
            const stop = end < 0 ? script.length : end;
            const inner = script.slice(i + 1, stop);
            word += ch === '"' ? inner.replace(/\\(.)/g, '$1') : inner;
            if (ch === '"' && /\$\(|`/.test(inner)) for (const c of splitShellCommands(inner.replace(/^[^$`]*/, ''))) cmds.push(c);
            inWord = true;
            i = stop;
        } else if (ch === ';' || ch === '|' || ch === '&' || ch === '\n' || ch === '(' || ch === ')' || ch === '`' || (ch === '$' && script[i + 1] === '(')) {
            // 명령 치환(`$(…)`·백틱)·서브셸도 별개 명령으로 본다
            flushCmd();
        } else if (/\s/.test(ch)) {
            flushWord();
        } else {
            word += ch;
            inWord = true;
        }
    }
    flushCmd();
    return cmds;
}

function buildInvocation(rawCommand: string, rawArgs: string[]): { inv: Invocation; shellScripts: string[] } {
    let { command, base } = normalizeCommand(rawCommand);
    let args = rawArgs;
    const shellScripts: string[] = [];
    if (base === 'env') {
        // env -S "명령 문자열" — 셸 문자열처럼 다시 쪼개 본다(deny)
        const split = args.findIndex((a) => a === '-S' || a === '--split-string' || a.startsWith('--split-string='));
        if (split >= 0) shellScripts.push(args[split].includes('=') ? args[split].slice(args[split].indexOf('=') + 1) : (args[split + 1] ?? ''));
        const rest = unwrapEnv(args);
        if (rest) { ({ command, base } = normalizeCommand(rest[0])); args = rest.slice(1); }
    }
    const shellFlags = MCP_SHELL_WRAPPERS[base];
    if (shellFlags) {
        for (let i = 0; i < args.length; i++) {
            const t = args[i].toLowerCase();
            const combined = /^-[a-z]*c[a-z]*$/.test(t) && (base !== 'cmd' && base !== 'powershell' && base !== 'pwsh');
            if (shellFlags.includes(t) || combined) {
                if (base === 'cmd') shellScripts.push(args.slice(i + 1).join(' '));
                else if (args[i + 1] !== undefined) shellScripts.push(args[i + 1]);
                break;
            }
        }
    }
    const rest = runnerArgs(base, args);
    const family = rest ? familyOfBase(base) : undefined;
    const pkgs = family && rest ? extractPackages(family, rest) : [];
    return { inv: { command, base, ...(family ? { family } : {}), ...(pkgs[0] ? { pkg: pkgs[0] } : {}), pkgs, tokens: rest ?? args }, shellScripts };
}

function formatPkg(p: PackageId): string {
    return p.version ? `${p.name}@${p.version}` : p.name;
}

/** PURE: MCP 서버 식별 — 저장·spawn 할 연결 설정과 같은 값으로 */
export function describeMcpServer(spec: McpServerSpec): McpServerDescriptor {
    const transport = (spec.transport ?? '').toLowerCase();
    const remote = transport === 'sse' || transport === 'streamable-http' || (transport !== 'stdio' && !spec.command && !!spec.url);
    if (remote) {
        const p = spec.url ? parseHttpUrl(spec.url) : null;
        if (!p) return { kind: 'unidentified', display: `url:${spec.url ? '(해석 불가)' : '(없음)'}` };
        return { kind: 'remote', ...p, display: `${p.scheme}://${p.host}${p.port ? `:${p.port}` : ''}${p.path}` };
    }
    const command = (spec.command ?? '').trim();
    if (!command || /\s/.test(command)) return { kind: 'unidentified', display: `command:${command ? '(해석 불가)' : '(없음)'}` };
    const args = (spec.args ?? []).map((a) => (typeof a === 'string' ? a : String(a)));
    const { inv: primary, shellScripts } = buildInvocation(command, args);
    const nested: Invocation[] = [];
    const queue = shellScripts.map((s) => ({ s, depth: 1 }));
    const addEmbedded = (words: string[], depth: number) => {
        // deny 용 — 인자 중간에 실행기·셸이 다시 나오면(`exec npx x`·`nohup npx x`·`timeout 9 npx x`·`docker run img npx x`) 그 자리부터도 본다
        for (let j = 1; j < words.length; j++) {
            const b = normalizeCommand(words[j]).base;
            if (!MCP_RUNNER_COMMANDS[b] && !MCP_SHELL_WRAPPERS[b] && b !== 'env') continue;
            const { inv, shellScripts: inner } = buildInvocation(words[j], words.slice(j + 1));
            nested.push(inv);
            if (depth < MCP_SHELL_UNWRAP_MAX_DEPTH) for (const x of inner) queue.push({ s: x, depth: depth + 1 });
        }
    };
    addEmbedded([command, ...args], 1);
    while (queue.length > 0) {
        const { s, depth } = queue.shift()!;
        for (const words of splitShellCommands(s)) {
            if (words.length === 0) continue;
            const { inv, shellScripts: inner } = buildInvocation(words[0], words.slice(1));
            nested.push(inv);
            if (depth < MCP_SHELL_UNWRAP_MAX_DEPTH) {
                for (const x of inner) queue.push({ s: x, depth: depth + 1 });
                addEmbedded(words, depth + 1);
            }
        }
    }
    return { kind: 'stdio', primary, nested, display: `${primary.command}${primary.pkg ? ` ${formatPkg(primary.pkg)}` : ''}` };
}
