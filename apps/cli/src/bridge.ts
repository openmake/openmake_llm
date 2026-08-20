/**
 * OpenMake Code CLI 브리지 — 서버 로컬 브리지 프로토콜의 CLI 클라이언트.
 *
 * apps/desktop/bridge.js 의 호스트 비의존 코어(프로토콜·경로 스코프·exec 3단 방어·worktree
 * 격리)를 이식하고, Electron 의존부(session 쿠키·dialog·agent-browser)만 CLI 어댑터로 대체한다:
 *   - 인증: 세션 쿠키 → API key(omk_live_*) 헤더
 *   - confirmExec: dialog.showMessageBox → 터미널 y/N/a 프롬프트
 *   - browser: 미지원(서버가 LOCAL_BRIDGE_BROWSER_ENABLED 로 게이트하므로 진입 안 함)
 *
 * 보안 불변식(데스크톱과 동일): 고정 kind 화이트리스트만, 파일 경로 realpath 스코프,
 * exec = DENYLIST hard-block → confirmExec → sandbox-exec(macOS), worktree 는 서버 op 만 받아
 * 디바이스가 git 인자를 고정 조립(명령 주입 차단).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, execFileSync } from 'child_process';
import WebSocket from 'ws';
import { deviceId } from './config';

const EXEC_TIMEOUT_MS = 120000;
const MAX_BUFFER = 1024 * 1024;
const RECONNECT_MS = 10000;
const PATH_PROBE_TIMEOUT_MS = 5000;
const SANDBOX_BIN = '/usr/bin/sandbox-exec';
const SANDBOX_ENABLED = process.platform === 'darwin' && process.env.OMK_BRIDGE_SANDBOX !== '0';
const CACHE_SUBPATHS = ['.npm', '.cache', 'Library/Caches', '.cargo', '.gradle', '.m2', '.yarn', '.pnpm-store', 'go/pkg'];
const SECRET_SUBPATHS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gcloud', 'Library/Keychains'];
const WORKTREE_DIR = '.openmake/worktrees';
const WORKTREE_BRANCH_PREFIX = 'omk-task/';
const TASK_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

const EXEC_DENYLIST: { re: RegExp; why: string }[] = [
    { re: /(^|[;&|(]|\s)sudo\s/, why: '권한 상승(sudo)' },
    { re: /(^|[;&|(]|\s)doas\s/, why: '권한 상승(doas)' },
    { re: /(curl|wget)\s[^|]*\|\s*(sh|bash|zsh)\b/, why: '원격 스크립트 직접 실행(pipe-to-shell)' },
    { re: /\|\s*(sh|bash|zsh)\b/, why: '파이프-투-셸 실행' },
    { re: /\brm\s+-\w*\s+(\/|~|\$HOME|\$\{HOME\})(\s|$)/, why: '홈/루트 대량 삭제' },
    { re: /\.ssh(\/|\b)/, why: 'SSH 키 디렉토리 접근' },
    { re: /id_rsa|id_ed25519|\.aws\/credentials|\.config\/gcloud/, why: '자격증명 파일 접근' },
    { re: /:\s*\(\s*\)\s*\{/, why: 'fork bomb' },
    { re: /\bdd\s+if=|\bmkfs\b|>\s*\/dev\/(disk|sd|rdisk)/, why: '디스크 파괴 연산' },
];
function matchDenylist(cmd: string): string | null {
    for (const d of EXEC_DENYLIST) if (d.re.test(String(cmd))) return d.why;
    return null;
}

interface BridgeMsg {
    type?: string;
    kind?: string;
    reqId?: string;
    command?: string;
    path?: string;
    contentB64?: string;
    op?: string;
    taskId?: string;
    spec?: unknown;
    message?: string;
}
interface BridgeResult {
    ok: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    content?: string;
    entries?: string[];
    error?: string;
    durationMs?: number;
    worktreeRel?: string;
    branch?: string;
    kept?: boolean;
}

/** confirmExec 어댑터 — 터미널에서 y(실행)/a(작업 동안 모두)/n(거부). 비대화형은 자동 거부(fail-safe). */
export type ConfirmFn = (command: string, taskId: string | undefined, folderRoot: string) => Promise<'yes' | 'all' | 'no'>;

export interface BridgeOptions {
    serverUrl: string;
    apiKey: string;
    /** 연결 폴더(단일) — 서버는 디바이스당 폴더 하나만 지원한다. */
    folder: string;
    confirm: ConfirmFn;
    onStatus?: (s: string) => void;
    autoApproveAll?: boolean; // 테스트/비대화형 훅
}

export class CliBridge {
    private ws: WebSocket | null = null;
    private readonly folderRoot: string;
    private sandboxProfilePath: string | null = null;
    private execPathCache: string | null = null;
    private readonly autoApproveTasks = new Set<string>();
    private reconnectTimer: NodeJS.Timeout | null = null;
    private closed = false;

    constructor(private readonly opts: BridgeOptions) {
        this.folderRoot = fs.realpathSync(opts.folder);
    }

    private status(s: string): void { this.opts.onStatus?.(s); }

    // ── PATH 보강 (데스크톱 resolveExecPath 이식) ──
    private resolveExecPath(): string {
        if (this.execPathCache) return this.execPathCache;
        const parts: string[] = [];
        try {
            parts.push(...execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'echo -n "$PATH"'],
                { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS }).trim().split(':'));
        } catch { /* noop */ }
        parts.push(...(process.env.PATH || '').split(':'));
        parts.push('/opt/homebrew/bin', '/usr/local/bin',
            path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.local/share/mise/shims'));
        let base = [...new Set(parts.filter(Boolean))].join(':');
        try {
            const misePaths = execFileSync('mise', ['bin-paths'],
                { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS, cwd: this.folderRoot || os.homedir(), env: { ...process.env, PATH: base } })
                .trim().split('\n').filter(Boolean);
            base = [...new Set([...misePaths, ...base.split(':')])].join(':');
        } catch { /* noop */ }
        this.execPathCache = base;
        return base;
    }

    private sbq(p: string): string { return `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }

    private detectGitDir(root: string): string | null {
        try {
            return execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8', timeout: 5000 }).trim() || null;
        } catch { return null; }
    }

    private writeSandboxProfile(root: string, gitDir: string | null): string | null {
        try {
            const home = fs.realpathSync(os.homedir());
            const sub = (base: string, list: string[]) => list.map((d) => `(subpath ${this.sbq(path.join(base, d))})`).join(' ');
            const profile = [
                '(version 1)',
                '(allow default)',
                '(deny file-write*)',
                `(allow file-write* (subpath ${this.sbq(root)}))`,
                ...(gitDir ? [`(allow file-write* (subpath ${this.sbq(gitDir)}))`] : []),
                '(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/dev"))',
                `(allow file-write* ${sub(home, CACHE_SUBPATHS)})`,
                `(deny file-read* ${sub(home, SECRET_SUBPATHS)})`,
                // 훅·config deny 는 반드시 맨 끝 (SBPL last-match-wins).
                ...(gitDir ? [`(deny file-write* (subpath ${this.sbq(path.join(gitDir, 'hooks'))}) (literal ${this.sbq(path.join(gitDir, 'config'))}))`] : []),
                '',
            ].join('\n');
            const p = path.join(os.tmpdir(), `omk-cli-sandbox-${process.pid}.sb`);
            fs.writeFileSync(p, profile);
            return p;
        } catch { return null; }
    }

    /** 경로 스코프 가드 — 연결 폴더 밖/심링크 탈출 차단 (데스크톱 safe 이식). */
    private safe(rel: string | undefined): string {
        const abs = path.resolve(this.folderRoot, rel || '.');
        if (abs !== this.folderRoot && !abs.startsWith(this.folderRoot + path.sep)) throw new Error(`폴더 스코프 밖 경로 거부: ${rel}`);
        let probe = abs;
        while (!fs.existsSync(probe)) probe = path.dirname(probe);
        const real = fs.realpathSync(probe);
        if (real !== this.folderRoot && !real.startsWith(this.folderRoot + path.sep)) throw new Error(`심링크 스코프 탈출 거부: ${rel}`);
        return abs;
    }

    // ── worktree (데스크톱 이식) ──
    private git(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
        return new Promise((resolve) => {
            execFile('git', args, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
                resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
            });
        });
    }
    private async isGitRepo(): Promise<boolean> {
        const r = await this.git(['rev-parse', '--is-inside-work-tree'], this.folderRoot);
        return r.code === 0 && r.stdout.trim() === 'true';
    }
    private excludeWorktreeDir(gitDir: string): void {
        try {
            const infoDir = path.join(gitDir, 'info');
            fs.mkdirSync(infoDir, { recursive: true });
            const p = path.join(infoDir, 'exclude');
            const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
            if (!cur.split('\n').some((l) => l.trim() === '.openmake/')) {
                fs.appendFileSync(p, `${cur.endsWith('\n') || cur === '' ? '' : '\n'}.openmake/\n`);
            }
        } catch { /* noop */ }
    }
    private async worktreeMetaDir(wtAbs: string): Promise<string | null> {
        const r = await this.git(['rev-parse', '--absolute-git-dir'], wtAbs);
        return r.code === 0 ? r.stdout.trim() : null;
    }
    private async writeBaseSha(wtAbs: string): Promise<void> {
        try {
            const meta = await this.worktreeMetaDir(wtAbs);
            const head = await this.git(['rev-parse', 'HEAD'], wtAbs);
            if (meta && head.code === 0) fs.writeFileSync(path.join(meta, 'omk-base'), head.stdout.trim());
        } catch { /* noop */ }
    }
    private async readBaseSha(wtAbs: string): Promise<string> {
        try {
            const meta = await this.worktreeMetaDir(wtAbs);
            const p = meta && path.join(meta, 'omk-base');
            if (p && fs.existsSync(p)) {
                const sha = fs.readFileSync(p, 'utf8').trim();
                if (/^[0-9a-f]{7,40}$/.test(sha)) return sha;
            }
        } catch { /* noop */ }
        return 'HEAD';
    }
    private async handleWorktree(m: BridgeMsg, done: (r: BridgeResult) => void): Promise<void> {
        const taskId = String(m.taskId || '');
        if (!TASK_ID_RE.test(taskId)) { done({ ok: false, error: '잘못된 taskId 형식' }); return; }
        const rel = `${WORKTREE_DIR}/${taskId}`;
        const abs = path.join(this.folderRoot, rel);
        const branch = `${WORKTREE_BRANCH_PREFIX}${taskId.slice(0, 8)}`;
        if (m.op === 'add') {
            if (!(await this.isGitRepo())) { done({ ok: false, error: 'git 레포가 아닙니다' }); return; }
            const prefixR = await this.git(['rev-parse', '--show-prefix'], this.folderRoot);
            const sub = prefixR.code === 0 ? prefixR.stdout.trim().replace(/\/+$/, '') : '';
            const workRel = sub ? `${rel}/${sub}` : rel;
            const gitDirR = await this.git(['rev-parse', '--absolute-git-dir'], this.folderRoot);
            if (gitDirR.code === 0) this.excludeWorktreeDir(gitDirR.stdout.trim());
            if (fs.existsSync(abs)) { done({ ok: true, worktreeRel: workRel, branch }); return; }
            const r = await this.git(['worktree', 'add', abs, '-b', branch], this.folderRoot);
            if (r.code !== 0) { done({ ok: false, error: `worktree 생성 실패: ${(r.stderr || r.stdout).trim().slice(0, 300)}` }); return; }
            await this.writeBaseSha(abs);
            done({ ok: true, worktreeRel: workRel, branch });
            return;
        }
        if (m.op === 'diff') {
            if (!fs.existsSync(abs)) { done({ ok: false, error: 'worktree 없음' }); return; }
            await this.git(['add', '-A', '-N', '.'], abs);
            const r = await this.git(['diff', await this.readBaseSha(abs)], abs);
            if (r.code !== 0) { done({ ok: false, error: `diff 실패: ${(r.stderr || '').trim().slice(0, 200)}` }); return; }
            done({ ok: true, stdout: r.stdout, branch });
            return;
        }
        if (m.op === 'remove') {
            if (!fs.existsSync(abs)) { done({ ok: true, kept: false }); return; }
            const st = await this.git(['status', '--porcelain'], abs);
            const head = await this.git(['rev-parse', 'HEAD'], abs);
            const moved = head.code === 0 && head.stdout.trim() !== (await this.readBaseSha(abs));
            if ((st.code === 0 && st.stdout.trim() !== '') || moved) { done({ ok: true, kept: true, branch }); return; }
            const r = await this.git(['worktree', 'remove', '--force', abs], this.folderRoot);
            if (r.code !== 0) { done({ ok: true, kept: true, branch }); return; }
            await this.git(['branch', '-D', branch], this.folderRoot);
            done({ ok: true, kept: false, branch });
            return;
        }
        done({ ok: false, error: `지원하지 않는 worktree op: ${m.op}` });
    }

    private walk(dir: string, base: string, out: string[]): string[] {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isSymbolicLink()) continue;
            if (e.isDirectory()) this.walk(p, base, out); else out.push(path.relative(base, p));
            if (out.length >= 1000) return out;
        }
        return out;
    }

    private async confirmExec(command: string, taskId: string | undefined): Promise<boolean> {
        if (this.opts.autoApproveAll || process.env.OMK_BRIDGE_AUTO_APPROVE === '1') return true;
        if (taskId && this.autoApproveTasks.has(taskId)) return true;
        const ans = await this.opts.confirm(command, taskId, this.folderRoot);
        if (ans === 'all' && taskId) { this.autoApproveTasks.add(taskId); return true; }
        return ans === 'yes';
    }

    private async handleExec(m: BridgeMsg, done: (r: BridgeResult) => void): Promise<void> {
        switch (m.kind) {
            case 'exec': {
                const denied = matchDenylist(String(m.command || ''));
                if (denied) { done({ ok: false, error: `위험 명령으로 차단됨: ${denied}`, exitCode: 126 }); return; }
                if (!(await this.confirmExec(String(m.command || ''), m.taskId))) {
                    done({ ok: false, error: '사용자가 명령 실행을 거부했습니다', exitCode: 126 }); return;
                }
                if (SANDBOX_ENABLED && !this.sandboxProfilePath) {
                    done({ ok: false, error: 'exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다. 비격리 실행이 필요하면 OMK_BRIDGE_SANDBOX=0 으로 실행하세요.', exitCode: 126 });
                    return;
                }
                const opts = { cwd: this.folderRoot, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8' as const, env: { ...process.env, PATH: this.resolveExecPath() } };
                const cb = (err: import('child_process').ExecFileException | null, stdout: string, stderr: string) => {
                    done({ ok: true, stdout: String(stdout), stderr: String(stderr), exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
                };
                if (SANDBOX_ENABLED && this.sandboxProfilePath) {
                    execFile(SANDBOX_BIN, ['-f', this.sandboxProfilePath, '/bin/bash', '-c', String(m.command)], opts, cb);
                } else {
                    execFile('/bin/bash', ['-c', String(m.command)], opts, cb);
                }
                return;
            }
            case 'read': done({ ok: true, content: fs.readFileSync(this.safe(m.path), 'utf8') }); return;
            case 'write': {
                const abs = this.safe(m.path);
                fs.mkdirSync(path.dirname(abs), { recursive: true });
                fs.writeFileSync(abs, Buffer.from(m.contentB64 || '', 'base64'));
                done({ ok: true }); return;
            }
            case 'list': {
                const entries = fs.readdirSync(this.safe(m.path), { withFileTypes: true })
                    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
                done({ ok: true, entries }); return;
            }
            case 'listAll': done({ ok: true, entries: this.walk(this.folderRoot, this.folderRoot, []) }); return;
            case 'delete': {
                const abs = this.safe(m.path);
                if (abs === this.folderRoot) throw new Error('연결 폴더 루트는 삭제할 수 없습니다');
                fs.rmSync(abs, { recursive: true, force: true });
                done({ ok: true }); return;
            }
            case 'browser':
                done({ ok: false, error: 'CLI 브리지는 로컬 브라우저를 지원하지 않습니다' }); return;
            case 'worktree':
                await this.handleWorktree(m, done); return;
            case 'task_end':
                if (m.taskId) this.autoApproveTasks.delete(m.taskId);
                done({ ok: true }); return;
            default: done({ ok: false, error: `지원하지 않는 kind: ${m.kind}` });
        }
    }

    connect(): void {
        this.closed = false;
        this.sandboxProfilePath = SANDBOX_ENABLED ? this.writeSandboxProfile(this.folderRoot, this.detectGitDir(this.folderRoot)) : null;
        // 데스크톱 bridge.js 와 동일 — 서버 WSS 는 { server } 라 경로 무관(패스 미부착).
        const wsUrl = this.opts.serverUrl.replace(/^http/, 'ws');
        try { if (this.ws) { this.ws.removeAllListeners(); this.ws.close(); } } catch { /* noop */ }
        // 네이티브 클라이언트라 Origin 헤더를 보내지 않는다 — 인증은 API key(헤더). 서버는
        // API key 요청에 한해 Origin 검증을 면제한다(CSWSH 는 쿠키 기반 브라우저 공격).
        this.ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.opts.apiKey}` } });
        this.status('연결 중…');
        this.ws.on('open', () => setTimeout(() => {
            // 서버가 연결을 등록하고 메시지 리스너를 부착할 때까지 대기(데스크톱 bridge.js 와 동일 300ms).
            // 즉시 전송하면 리스너 부착 전 프레임이 유실돼 등록이 안 된다(라이브에서 확인).
            if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
            this.ws.send(JSON.stringify({
                type: 'bridge_hello',
                deviceId: deviceId(),
                label: `${os.hostname()} · ${path.basename(this.folderRoot)}`,
                folderName: path.basename(this.folderRoot),
            }));
        }, 300));
        this.ws.on('message', (d: WebSocket.RawData) => {
            let m: BridgeMsg;
            try { m = JSON.parse(d.toString()) as BridgeMsg; } catch { return; }
            if (m.type === 'bridge_ready') { this.status(`연결됨: ${path.basename(this.folderRoot)}`); return; }
            if (m.type === 'error') { this.status(`서버 오류: ${m.message ?? ''}`); return; }
            if (m.type !== 'bridge_exec') return;
            const t0 = Date.now();
            const done = (result: BridgeResult) => {
                try { this.ws!.send(JSON.stringify({ type: 'bridge_result', reqId: m.reqId, result: { durationMs: Date.now() - t0, ...result } })); } catch { /* noop */ }
            };
            Promise.resolve().then(() => this.handleExec(m, done)).catch((e) => done({ ok: false, error: String((e as Error).message || e) }));
        });
        this.ws.on('close', () => {
            if (this.closed) { this.status('종료'); return; }
            this.status('끊김 — 재연결 대기');
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
        });
        this.ws.on('error', () => { /* close 가 후속 처리 */ });
    }

    disconnect(): void {
        this.closed = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.autoApproveTasks.clear();
        try { if (this.ws) this.ws.close(); } catch { /* noop */ }
        this.ws = null;
    }
}
