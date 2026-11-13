/**
 * worktree 격리 (로컬 실행기) — 에이전트가 사용자의 현재 작업트리·브랜치를 직접 건드리지
 * 않도록, 연결 폴더가 git 레포면 별도 worktree(=별도 디렉토리 + 별도 브랜치)를 만들어
 * 그 안에서만 작업하게 한다.
 *
 * 왜 연결 폴더 '안'인가: exec 는 sandbox-exec 로 폴더 밖 쓰기가 커널 차단되고, 파일 kind 는
 * safe() 스코프에 걸린다. 폴더 밖에 만들면 두 방어에 모두 막혀 아무것도 못 한다.
 * 대신 .git/info/exclude 에 등록해 사용자의 git status·.gitignore 를 오염시키지 않는다.
 *
 * git 명령은 **서버 문자열을 쓰지 않고 여기서 인자 배열로 조립**한다(명령 주입 차단).
 * 그래도 git 은 연결 폴더 안의 파일(`.git/config`·`.gitattributes`·worktree 의 gitfile)을 설정으로 읽는다 — 폴더 안은
 * 에이전트가 쓸 수 있어 설정을 고치면 확인 없이 코드가 돌았다(설계 2026-11-14 E1·E1c). 그래서 ① 모든 git 을 도구
 * 프로파일 안에서 띄우고(폴더 밖 쓰기·네트워크 차단, 프로파일이 없으면 띄우지 않는다) ② `GIT_FIXED_ARGS` 로
 * fsmonitor·훅을 끄며 ③ 연산 직전 git 디렉터리가 연결 때 믿기로 한 값(git-trust.ts)과 같은지 대조한다(다르면 띄우지 않는다).
 *
 * 경로는 글자로 이어 붙인 뒤 **파일 kind 와 같은 realpath 스코프**로 검사한다(위치 확인과 exclude 쓰기는 이 프로세스가 한다). 연결 폴더 안 파일은 에이전트가 쓸 수 있어, `.openmake`·`worktrees`·`<taskId>`(또는 worktree 안의
 * 하위 폴더)를 폴더 밖 심링크로 바꿔 두면 add·remove 가 폴더 밖에 만들고 지울 수 있었다(2026-11-13).
 * 요청 첫머리와 `git worktree add`·`worktree remove` 바로 앞에서 두 번 검사한다 — 남는 틈(TOCTOU)은 검사 직후
 * git 호출 하나로, 파일 kind(검사 직후 fs 호출 하나)와 같은 수준이다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { EXEC_TIMEOUT_MS, GIT_DIR_MISMATCH_ERROR, GIT_FIXED_ARGS, MAX_BUFFER, TASK_ID_RE, WORKTREE_BRANCH_PREFIX, WORKTREE_DIR } from './constants';
import { buildExecEnv } from './exec-env';
import { readRegularFile, type GitPaths } from './git-trust';
import { SandboxProfileMissingError, sandboxExecFailed, wrapInSandbox } from './sandbox';
import { safeFrom, safeFromAsync } from './scope';
import type { BridgeMsg, BridgeResult } from './types';

const NOT_A_REPO = 'git 레포가 아닙니다';

/**
 * 코어가 연결 때 고정한 것 — 연결 폴더 realpath, 믿기로 한 git 디렉터리(없으면 git 없음), 도구 프로파일
 * (undefined = 샌드박스 꺼짐, null = 없음).
 */
export interface WorktreeCtx { root: string; git: GitPaths | null; profile: string | null | undefined }

type GitOut = { code: number; stdout: string; stderr: string };

/**
 * git 하나 — `GIT_FIXED_ARGS` 를 붙이고 도구 프로파일로 감싼다. 프로파일이 없으면 띄우지 않고, sandbox-exec 자체가
 * 실패하면(65·71) 결과를 삼키지 않고 SandboxProfileMissingError 를 던진다(코어가 도구와 같은 126 거절로 바꾼다).
 */
export async function gitRun(args: string[], cwd: string, profile: string | null | undefined): Promise<GitOut> {
    const cmd = wrapInSandbox('git', [...GIT_FIXED_ARGS, ...args], profile);
    const r = await new Promise<GitOut>((resolve) => {
        // 자식 환경은 exec 와 같은 allowlist 로 제한한다. 여기서 쓰는 연산은 모두 로컬이라 SSH·GPG·GIT_* 가 필요 없다.
        execFile(cmd.file, cmd.args, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: buildExecEnv(process.env, process.env.PATH ?? '') }, (err, stdout, stderr) => {
            resolve({
                code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0,
                stdout: String(stdout), stderr: String(stderr),
            });
        });
    });
    if (r.code !== 0 && sandboxExecFailed(profile !== undefined, r.code, r.stderr)) throw new SandboxProfileMissingError();
    return r;
}

type Git = (args: string[], cwd: string) => Promise<GitOut>;

/** cwd 의 git dir·common dir(realpath) — git 이 아니거나 못 구하면 null. rev-parse 는 fsmonitor 를 돌리지 않는다(E1 실측). */
async function gitDirsOf(git: Git, cwd: string): Promise<GitPaths | null> {
    const r = await git(['rev-parse', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir'], cwd);
    const [g, c] = r.code === 0 ? r.stdout.split('\n') : [];
    if (!g || !c) return null;
    try { return { gitDir: await fs.promises.realpath(g), commonDir: await fs.promises.realpath(c) }; } catch { return null; }
}

const within = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + path.sep);

/**
 * base 의 레포 — 연결 때 믿기로 한 것과 같으면 그것, 다르거나(폴더 선택으로 고른 중첩 레포) 보관한 git 이 없으면 base 의
 * git dir·common dir 가 **둘 다 연결 폴더 안**일 때만 그 값(design.md D-3 의 4번 배치 — 어차피 쓰기 가능한 곳이고, git 은
 * 도구 프로파일 안에서 돈다). 하나라도 폴더 밖이면 거절 문구. 탐지 git 도 도구 프로파일 + 고정 인자 안에서 돈다.
 */
async function repoFor(git: Git, base: string, ctx: WorktreeCtx, op: string): Promise<GitPaths | string> {
    const d = await gitDirsOf(git, base);
    if (d && ctx.git && d.gitDir === ctx.git.gitDir && d.commonDir === ctx.git.commonDir) return ctx.git;
    if (d && within(d.gitDir, ctx.root) && within(d.commonDir, ctx.root)) return d;
    return op === 'add' && (!ctx.git || !d) ? NOT_A_REPO : GIT_DIR_MISMATCH_ERROR;
}

/** worktree 안의 git dir 가 `<base 레포의 common>/worktrees/` 바로 아래인가 — worktree 의 gitfile 을 가짜로 바꿔 두면 아니다(E1c). */
async function worktreeTrusted(git: Git, abs: string, trusted: GitPaths): Promise<boolean> {
    const d = await gitDirsOf(git, abs);
    return !!d && d.commonDir === trusted.commonDir && path.dirname(d.gitDir) === path.join(trusted.commonDir, 'worktrees');
}

const isSymlink = (p: string): boolean => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

/**
 * 이 프로세스(샌드박스 밖)가 git 디렉터리 안에 파일을 쓴다 — 그 자리는 샌드박스 안의 자식(필터·exec)이 쓸 수 있어 심링크로 바꿔
 * 둘 수 있다. 따라가면 폴더 밖 파일을 덮어쓴다(리뷰 F5, M3). 그래서 **새 이름으로 만들고(O_CREAT|O_EXCL — 심링크면 실패한다)
 * rename 으로 바꿔 넣는다**(rename 은 대상 자리의 심링크를 따라가지 않고 그 항목을 바꾼다). 실패는 던진다(호출측이 삼킨다).
 */
function writeNoFollow(dir: string, name: string, content: string): void {
    const tmp = path.join(dir, `${name}.omk-${process.pid}`);
    fs.rmSync(tmp, { force: true }); // 남은 임시 이름(심링크여도 링크만 지운다)
    fs.writeFileSync(tmp, content, { flag: 'wx' });
    try { fs.renameSync(tmp, path.join(dir, name)); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

/**
 * worktree 디렉토리를 로컬 전용 제외 목록에 등록 — 사용자의 .gitignore 는 건드리지 않는다. 제외 목록은 common dir 에 있다
 * (linked worktree 도 `$GIT_COMMON_DIR/info/exclude` 를 읽는다). `info`·`info/exclude` 는 에이전트가 바꿀 수 있다 —
 * 폴더 밖 심링크는 물론 git 디렉터리 안쪽 심링크(→ config 등, M3)도 따라가면 그 파일 끝에 줄이 붙으므로 심링크면 등록하지 않고,
 * 쓰기는 따라가지 않는 바꿔 넣기로 한다.
 */
function excludeWorktreeDir(gitDir: string): void {
    try {
        safeFrom(gitDir, 'info/exclude');
        const infoDir = path.join(gitDir, 'info');
        const p = path.join(infoDir, 'exclude');
        if (isSymlink(infoDir) || isSymlink(p)) return;
        fs.mkdirSync(infoDir, { recursive: true });
        // 일반 파일만·MAX_BUFFER 이하만 읽는다 — FIFO·소켓·장치면 동기 읽기가 이벤트 루프를 멈췄다(리뷰 N3), 큰 파일도 그만큼
        // 잡는다(리뷰 R4). 그때는 등록을 건너뛴다.
        const cur = fs.lstatSync(p, { throwIfNoEntry: false }) ? readRegularFile(p, MAX_BUFFER) : '';
        if (cur === null) return;
        if (!cur.split('\n').some((l) => l.trim() === '.openmake/')) {
            writeNoFollow(infoDir, 'exclude', `${cur}${cur.endsWith('\n') || cur === '' ? '' : '\n'}.openmake/\n`);
        }
    } catch { /* 제외 등록 실패는 치명적이지 않다(사용자 status 에 보일 뿐) */ }
}

/**
 * diff 기준점(worktree 생성 시점 커밋) 저장·조회.
 *
 * worktree 메타 디렉토리(`.git/worktrees/<name>/`)에 둔다 — 작업트리 밖이라 diff·status 에
 * 잡히지 않고, `git worktree remove` 시 함께 정리된다. 읽기 실패 시 'HEAD' 로 폴백한다
 * (커밋이 있었다면 그 변경은 놓치지만, diff 캡처 자체가 죽지는 않는다).
 * 메타 폴더는 그 레포의 `<common>/worktrees/` 바로 아래일 때만 쓴다(git 이 답한 값을 대조 없이 쓰지 않는다).
 */
async function worktreeMetaDir(git: Git, wtAbs: string, repo: GitPaths): Promise<string | null> {
    const r = await git(['rev-parse', '--absolute-git-dir'], wtAbs);
    if (r.code !== 0) return null;
    const meta = await fs.promises.realpath(r.stdout.trim()).catch(() => null);
    return meta && path.dirname(meta) === path.join(repo.commonDir, 'worktrees') ? meta : null;
}

/** 프로파일 없음은 삼키지 않는다 — 그 밖의 실패는 치명적이지 않다(HEAD 폴백). */
function rethrowSandbox(e: unknown): void {
    if (e instanceof SandboxProfileMissingError) throw e;
}

async function writeBaseSha(git: Git, wtAbs: string, repo: GitPaths): Promise<void> {
    try {
        const meta = await worktreeMetaDir(git, wtAbs, repo);
        const head = await git(['rev-parse', 'HEAD'], wtAbs);
        if (meta && head.code === 0) writeNoFollow(meta, 'omk-base', head.stdout.trim());
    } catch (e) { rethrowSandbox(e); }
}

/** 기준점 읽기 — 심링크는 읽지 않는다(일반 파일만). */
async function readBaseSha(git: Git, wtAbs: string, repo: GitPaths): Promise<string> {
    try {
        const meta = await worktreeMetaDir(git, wtAbs, repo);
        const p = meta && path.join(meta, 'omk-base');
        if (p && fs.lstatSync(p, { throwIfNoEntry: false })?.isFile()) {
            const sha = fs.readFileSync(p, 'utf8').trim();
            if (/^[0-9a-f]{7,40}$/.test(sha)) return sha;
        }
    } catch (e) { rethrowSandbox(e); }
    return 'HEAD';
}

/** worktree 루트와 대상 모두 연결 폴더 realpath 안이어야 한다(최근접 조상 realpath — 안쪽 심링크는 허용). 밖이면 거부 문구. */
async function scopeError(base: string, rel: string): Promise<string | null> {
    try {
        await safeFromAsync(base, WORKTREE_DIR);
        await safeFromAsync(base, rel);
        return null;
    } catch (e) { return (e as Error).message; }
}

/**
 * 실패한 `worktree add` 가 남긴 것을 치운다 — 폴더가 남으면 다음 요청이 "재개"로 오인하고, 등록(메타)이 남으면 같은 자리의
 * 다음 add 가 "missing but already registered" 로, 브랜치가 남으면 "이미 있다"로 실패한다(필수 필터가 실패하면 git 은 폴더·
 * 메타는 지우지만 브랜치는 남긴다 — 2026-11-14 실측). **이 worktree 만** 치운다 — `git worktree prune` 은 레포 전체의 폴더 없는
 * 등록(분리된 볼륨의 worktree 등)을 즉시 지웠다(리뷰 F8). `worktree remove --force` 는 폴더가 없는 등록도 지운다(실측).
 * 브랜치는 이번 add 가 만든 것만 지운다(이미 있던 같은 이름 브랜치는 사용자 것일 수 있다).
 */
async function cleanupFailedAdd(git: Git, base: string, rel: string, abs: string, branch: string, hadBranch: boolean): Promise<void> {
    await git(['worktree', 'remove', '--force', abs], base);
    if (fs.existsSync(abs) && !(await scopeError(base, rel))) fs.rmSync(abs, { recursive: true, force: true });
    if (!hadBranch) await git(['branch', '-D', branch], base);
}

export async function handleWorktree(m: BridgeMsg, done: (r: BridgeResult) => void, base: string, ctx: WorktreeCtx): Promise<void> {
    const taskId = String(m.taskId || '');
    if (!TASK_ID_RE.test(taskId)) { done({ ok: false, error: '잘못된 taskId 형식' }); return; }
    // 폴더 선택 시 worktree 도 base(선택 폴더) 하위에 만들고, worktreeRel 은 base 기준
    // 상대경로로 돌려준다 — 서버는 folder+worktreeRel 을 그대로 합성해 라우팅한다.
    const rel = `${WORKTREE_DIR}/${taskId}`;
    const abs = path.join(base, rel);
    const branch = `${WORKTREE_BRANCH_PREFIX}${taskId.slice(0, 8)}`;
    const git: Git = (args, cwd) => gitRun(args, cwd, ctx.profile);

    if (m.op === 'add' || m.op === 'diff' || m.op === 'remove') {
        const err = await scopeError(base, rel);
        if (err) { done({ ok: false, error: err }); return; }
    }

    if (m.op === 'add') {
        const repo = await repoFor(git, base, ctx, 'add');
        if (typeof repo === 'string') { done({ ok: false, error: repo }); return; }
        const inside = await git(['rev-parse', '--is-inside-work-tree'], base);
        if (inside.code !== 0 || inside.stdout.trim() !== 'true') { done({ ok: false, error: NOT_A_REPO }); return; }
        // worktree 는 **레포 전체**를 체크아웃한다. 연결 폴더가 레포 루트가 아니라 하위 디렉토리면
        // (예: 레포 /repo 를 두고 /repo/apps/web 을 연결) worktree 루트는 /repo 에 대응하므로,
        // 에이전트의 상대경로가 그대로면 다른 위치를 가리킨다. show-prefix 만큼 더 내려가 맞춘다.
        const prefixR = await git(['rev-parse', '--show-prefix'], base);
        const sub = prefixR.code === 0 ? prefixR.stdout.trim().replace(/\/+$/, '') : '';
        const workRel = sub ? `${rel}/${sub}` : rel;
        // 연결/선택 폴더가 **untracked**(HEAD 에 없는) 하위 디렉토리면 worktree 체크아웃에
        // 해당 경로가 없어 exec cwd 가 ENOENT 로 실패한다 — 빈 디렉토리로 보장한다.
        // (worktree 는 어차피 tracked 내용만 담으므로 격리 의미는 동일: 빈 폴더에서 시작.)
        // worktree 안은 에이전트가 쓸 수 있다 — 하위 경로가 폴더 밖 심링크면 만들지 않는다(스코프 거부도 exec 가 드러낸다).
        const ensureSub = (): void => {
            if (sub) { try { fs.mkdirSync(safeFrom(base, workRel), { recursive: true }); } catch { /* exec 가 후속 실패로 노출 */ } }
        };
        excludeWorktreeDir(repo.commonDir);
        if (fs.existsSync(abs)) { ensureSub(); done({ ok: true, worktreeRel: workRel, branch }); return; } // 재개 시 재사용
        const hadBranch = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], base)).code === 0;
        // 첫 검사 뒤 git 여러 번·exclude 쓰기가 끼었다 — 바로 앞에서 다시 본다.
        const late = await scopeError(base, rel);
        if (late) { done({ ok: false, error: late }); return; }
        const r = await git(['worktree', 'add', abs, '-b', branch], base);
        if (r.code !== 0) {
            await cleanupFailedAdd(git, base, rel, abs, branch, hadBranch);
            done({ ok: false, error: `worktree 생성 실패: ${(r.stderr || r.stdout).trim().slice(0, 300)}` }); return;
        }
        await writeBaseSha(git, abs, repo);
        ensureSub();
        done({ ok: true, worktreeRel: workRel, branch });
        return;
    }

    if (m.op === 'diff') {
        if (!fs.existsSync(abs)) { done({ ok: false, error: 'worktree 없음' }); return; }
        const repo = await repoFor(git, base, ctx, String(m.op));
        if (typeof repo === 'string') { done({ ok: false, error: repo }); return; }
        if (!(await worktreeTrusted(git, abs, repo))) { done({ ok: false, error: GIT_DIR_MISMATCH_ERROR }); return; }
        // -N: 새 파일을 인덱스에 '의도만' 등록해 diff 에 포함시킨다(실제 스테이징·커밋은 하지 않음).
        await git(['add', '-A', '-N', '.'], abs);
        // 기준점은 **worktree 생성 시점의 커밋**이다. HEAD 를 쓰면 에이전트가 중간에 커밋했을 때
        // 그 변경이 diff 에서 사라진다(2026-08-09 라이브 E2E 에서 실제 발생 — 모델이 작업을 커밋해
        // diff 에 마지막 미커밋 파일 하나만 남았다).
        const r = await git(['diff', await readBaseSha(git, abs, repo)], abs);
        if (r.code !== 0) { done({ ok: false, error: `diff 실패: ${(r.stderr || '').trim().slice(0, 200)}` }); return; }
        done({ ok: true, stdout: r.stdout, branch });
        return;
    }

    if (m.op === 'remove') {
        if (!fs.existsSync(abs)) { done({ ok: true, kept: false }); return; }
        const repo = await repoFor(git, base, ctx, String(m.op));
        if (typeof repo === 'string') { done({ ok: false, error: repo }); return; }
        if (!(await worktreeTrusted(git, abs, repo))) { done({ ok: false, error: GIT_DIR_MISMATCH_ERROR }); return; }
        // 변경분이 남아 있으면 **지우지 않는다** — 사용자 디스크의 작업 결과를 임의 삭제하지 않는다.
        // 미커밋 변경뿐 아니라 **에이전트가 만든 커밋**도 보존 대상이다(HEAD 가 기준점에서 움직였는지).
        const st = await git(['status', '--porcelain'], abs);
        const head = await git(['rev-parse', 'HEAD'], abs);
        const moved = head.code === 0 && head.stdout.trim() !== (await readBaseSha(git, abs, repo));
        if ((st.code === 0 && st.stdout.trim() !== '') || moved) { done({ ok: true, kept: true, branch }); return; }
        const late = await scopeError(base, rel); // 첫 검사 뒤 git 여러 번이 끼었다 — 바로 앞에서 다시 본다.
        if (late) { done({ ok: false, error: late }); return; }
        const r = await git(['worktree', 'remove', '--force', abs], base);
        if (r.code !== 0) { done({ ok: true, kept: true, branch }); return; } // 제거 실패도 보존으로 취급
        await git(['branch', '-D', branch], base); // 변경 없는 빈 브랜치 정리(실패 무시)
        done({ ok: true, kept: false, branch });
        return;
    }

    done({ ok: false, error: `지원하지 않는 worktree op: ${m.op}` });
}
