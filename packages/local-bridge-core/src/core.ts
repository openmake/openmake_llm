/**
 * BridgeCore — 브리지 디바이스의 호스트 비의존 실행 코어.
 *
 * 서버 bridge_exec 요청(kind 화이트리스트 10종)을 처리한다. 데스크톱 bridge.js 와
 * CLI bridge.ts 에 자구 동일하게 이식돼 있던 로직의 단일화 (2026-08-22, 축2 plan 1단계).
 *
 * 보안 불변식 (양쪽 구현에서 그대로 이관 — 변경 금지):
 *  - 고정 kind 화이트리스트만 처리 (임의 RPC 거부)
 *  - 파일 kind 경로는 연결 폴더 realpath 스코프 안에서만 해석 (심링크 탈출 차단, scope.ts)
 *  - exec 3단 방어: ① EXEC_DENYLIST hard-block ② confirmExec(비우회, 호스트 어댑터)
 *    ③ sandbox-exec — 프로파일 준비 실패 시 fail-closed
 *  - 일괄 승인('all')은 그 작업 한정, task_end·해제 시 회수. 서버가 켤 수 없다(선택 주체=사용자)
 *  - worktree 는 서버 op 만 받아 git 인자를 디바이스가 고정 조립 (worktree.ts)
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import {
    EXEC_TIMEOUT_MS, FOLDERS_MAX_ENTRIES, FS_OP_TIMEOUT_MS, LIST_ALL_MAX, MAX_BUFFER,
    SANDBOX_BIN, SANDBOX_ENABLED,
} from './constants';
import { matchDenylist } from './denylist';
import { resolveExecPath } from './exec-path';
import { detectGitDir, writeSandboxProfile } from './sandbox';
import { safeFromAsync } from './scope';
import { handleWorktree } from './worktree';
import type { BridgeCoreOptions, BridgeMsg, BridgeResult } from './types';

const fsp = fs.promises;

export class BridgeCore {
    readonly folderRoot: string;
    private sandboxProfilePath: string | null = null;
    private execPathCache: string | null = null;
    private readonly autoApproveTasks = new Set<string>();

    constructor(private readonly opts: BridgeCoreOptions) {
        this.folderRoot = fs.realpathSync(opts.folder);
    }

    /**
     * 연결(폴더 확정) 시 1회 준비 — 샌드박스 프로파일 생성 + PATH 캐시 리셋.
     * 폴더가 바뀌면 mise 프로젝트 버전·샌드박스 스코프도 바뀐다.
     */
    prepare(): void {
        this.execPathCache = null;
        this.sandboxProfilePath = SANDBOX_ENABLED
            ? writeSandboxProfile(this.folderRoot, detectGitDir(this.folderRoot),
                path.join(this.opts.sandboxProfileDir, `omk-exec-sandbox-${process.pid}.sb`))
            : null;
    }

    /** 일괄 승인 중인 작업 수 — 호스트 UI(메뉴 등) 표시용. */
    autoApprovedCount(): number { return this.autoApproveTasks.size; }

    /** 일괄 승인 전체 회수 — 연결 해제·사용자 명시 해제 시 호출. */
    clearAutoApprove(): void {
        this.autoApproveTasks.clear();
        this.opts.onAutoApproveChange?.();
    }

    /** exec 실행 전 사용자 확인(비우회). 'all' 선택은 그 작업 동안만 유효. */
    private async confirmExec(command: string, taskId: string | undefined, base: string): Promise<boolean> {
        // 테스트 훅(개발/E2E 전용): 확인 없이 자동 승인 (다른 OMK_BRIDGE_* 훅과 동일 계열).
        if (this.opts.autoApproveAll || process.env.OMK_BRIDGE_AUTO_APPROVE === '1') return true;
        if (taskId && this.autoApproveTasks.has(taskId)) return true;
        // 확인 창엔 유효 실행 폴더(base)를 보여준다 — 어느 폴더에서 도는지 투명하게.
        const ans = await this.opts.confirm(command, taskId, base);
        if (ans === 'all' && taskId) {
            this.autoApproveTasks.add(taskId);
            this.opts.onAutoApproveChange?.();
            return true;
        }
        return ans === 'yes';
    }

    /**
     * 파일 kind FS 처리 타임아웃 가드 — OS 가 FS 호출을 무기한 블록하면(외장 볼륨 TCC
     * 권한 미결 실사례: readdir 가 open 에서 영구 대기 → sync 시절엔 이벤트 루프가 굶어
     * pong 이 끊기고 이 헬퍼의 **모든 루트 연결**이 하트비트로 강제 종료됐다) 요청을
     * 오류로 해소한다. FS 호출은 전부 async(fsp)라 블록돼도 threadpool 에서 대기할 뿐
     * 이벤트 루프·다른 루트는 살아 있다. 블록된 호출 자체는 취소 불가(스레드 점유 잔존).
     */
    private async timedFs<T>(label: string, fn: () => Promise<T>): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                fn(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(
                        `${label} 시간 초과 (${Math.round(FS_OP_TIMEOUT_MS / 1000)}s) — 폴더 접근이 차단됐을 수 있습니다(디스크 접근 권한 확인)`,
                    )), FS_OP_TIMEOUT_MS);
                }),
            ]);
        } finally { clearTimeout(timer); }
    }

    /**
     * 폴더 선택(folder 필드) base 해석 — 루트 기준 상대경로를 스코프 재검증 후 실행 base 로 쓴다.
     * 서버는 디바이스가 folders 로 보고한 값만 에코하지만, 여기서 다시 스코프를 강제한다(2중 방어).
     */
    private async resolveBase(m: BridgeMsg): Promise<string> {
        if (!m.folder) return this.folderRoot;
        const base = await safeFromAsync(this.folderRoot, m.folder);
        const st = await fsp.stat(base).catch(() => null);
        if (!st || !st.isDirectory()) throw new Error(`실행 폴더가 존재하지 않습니다: ${m.folder}`);
        return base;
    }

    private async walk(dir: string, base: string, out: string[]): Promise<string[]> {
        for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isSymbolicLink()) continue; // 심링크는 나열하지 않음
            if (e.isDirectory()) await this.walk(p, base, out); else out.push(path.relative(base, p));
            if (out.length >= LIST_ALL_MAX) return out;
        }
        return out;
    }

    async handleExec(m: BridgeMsg, done: (r: BridgeResult) => void): Promise<void> {
        // 폴더 선택(folder 필드) — 유효 base 를 먼저 확정. 미지정은 연결 루트(현행 동작).
        const base = await this.timedFs('실행 폴더 확인', () => this.resolveBase(m));
        switch (m.kind) {
            case 'exec': {
                // ① 명백히 위험한 패턴은 확인 없이 즉시 거부 (guardrail).
                const denied = matchDenylist(String(m.command || ''));
                if (denied) { done({ ok: false, error: `위험 명령으로 차단됨: ${denied}`, exitCode: 126 }); return; }
                // ② 나머지는 실행 전 사용자 확인 (비우회). 같은 작업 안에서는 사용자가 일괄 승인할 수 있다.
                if (!(await this.confirmExec(String(m.command || ''), m.taskId, base))) {
                    done({ ok: false, error: '사용자가 명령 실행을 거부했습니다', exitCode: 126 }); return;
                }
                // ③ OS 샌드박스로 감싸 실행 — 폴더 밖 쓰기·비밀 읽기를 커널이 차단한다.
                //    프로파일 준비 실패 시 fail-closed(비격리 실행 거부). 해제는 OMK_BRIDGE_SANDBOX=0.
                if (SANDBOX_ENABLED && !this.sandboxProfilePath) {
                    done({ ok: false, error: 'exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다(폴더 재연결 필요). 비격리 실행이 필요하면 OMK_BRIDGE_SANDBOX=0 으로 실행하세요.', exitCode: 126 });
                    return;
                }
                if (!this.execPathCache) this.execPathCache = resolveExecPath(this.folderRoot);
                const opts = {
                    cwd: base, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8' as const,
                    env: { ...process.env, PATH: this.execPathCache },
                };
                const cb = (err: import('child_process').ExecFileException | null, stdout: string, stderr: string): void => {
                    done({ ok: true, stdout: String(stdout), stderr: String(stderr), exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
                };
                if (SANDBOX_ENABLED && this.sandboxProfilePath) {
                    execFile(SANDBOX_BIN, ['-f', this.sandboxProfilePath, '/bin/bash', '-c', String(m.command)], opts, cb);
                } else {
                    execFile('/bin/bash', ['-c', String(m.command)], opts, cb);
                }
                return;
            }
            case 'read': {
                const content = await this.timedFs('read', async () => fsp.readFile(await safeFromAsync(base, m.path), 'utf8'));
                done({ ok: true, content }); return;
            }
            case 'write': {
                await this.timedFs('write', async () => {
                    const abs = await safeFromAsync(base, m.path);
                    await fsp.mkdir(path.dirname(abs), { recursive: true });
                    await fsp.writeFile(abs, Buffer.from(m.contentB64 || '', 'base64'));
                });
                done({ ok: true }); return;
            }
            case 'list': {
                // 디렉토리는 '/' 접미사 — 모델이 폴더를 파일로 오인해 read 하다 EISDIR 로
                // 실패하고 하위 파일에 못 닿는 문제 방지 (샌드박스 실행기와 동일 규약).
                const entries = await this.timedFs('list', async () =>
                    (await fsp.readdir(await safeFromAsync(base, m.path), { withFileTypes: true }))
                        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name)));
                done({ ok: true, entries }); return;
            }
            case 'listAll': done({ ok: true, entries: await this.timedFs('listAll', () => this.walk(base, base, [])) }); return;
            case 'delete': {
                await this.timedFs('delete', async () => {
                    const abs = await safeFromAsync(base, m.path);
                    if (abs === base) throw new Error('연결 폴더 루트는 삭제할 수 없습니다');
                    await fsp.rm(abs, { recursive: true, force: true });
                });
                done({ ok: true }); return;
            }
            case 'folders': {
                // 하위 폴더 온디맨드 열거(폴더 선택) — path 는 루트 기준, 숨김·심링크 제외,
                // 결과는 루트 기준 상대경로(서버가 세션 캐시에 병합해 folder 검증 근거로 쓴다).
                const r = await this.timedFs('folders', async () => {
                    const dirAbs = await safeFromAsync(this.folderRoot, m.path);
                    const entries: string[] = [];
                    let truncated = false;
                    for (const e of await fsp.readdir(dirAbs, { withFileTypes: true })) {
                        if (!e.isDirectory() || e.name.startsWith('.')) continue;
                        if (entries.length >= FOLDERS_MAX_ENTRIES) { truncated = true; break; }
                        entries.push(path.relative(this.folderRoot, path.join(dirAbs, e.name)).split(path.sep).join('/'));
                    }
                    return { entries, truncated };
                });
                done({ ok: true, ...r }); return;
            }
            case 'browser': {
                // 로컬 브라우저(D3) — 데스크톱(Electron 내장 Chromium)만 어댑터로 구현한다.
                if (!this.opts.browser) { done({ ok: false, error: '이 디바이스는 로컬 브라우저를 지원하지 않습니다' }); return; }
                try {
                    const out = await this.opts.browser(m.spec || {});
                    // 컨테이너 runner 와 동일하게 stdout 에 JSON 을 싣는다(서버 파싱 재사용).
                    done({ ok: true, stdout: JSON.stringify(out), exitCode: out.ok ? 0 : 1 });
                } catch (e) {
                    done({ ok: false, error: `로컬 브라우저 실행 실패: ${(e as Error).message}` });
                }
                return;
            }
            case 'worktree':
                await handleWorktree(m, done, base); return;
            case 'task_end':
                this.opts.onTaskEnd?.(m.taskId); // 호스트 정리(데스크톱=브라우저 패널 닫기)
                // 일괄 승인은 그 작업에만 유효 — 종료 즉시 회수한다.
                if (m.taskId && this.autoApproveTasks.delete(m.taskId)) this.opts.onAutoApproveChange?.();
                done({ ok: true }); return;
            default: done({ ok: false, error: `지원하지 않는 kind: ${m.kind}` });
        }
    }
}
