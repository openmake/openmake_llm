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
 * 그래서 confirmExec(사용자 확인) 없이 수행해도 안전하다 — 실행 대상이 고정된 git 연산뿐이다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { EXEC_TIMEOUT_MS, MAX_BUFFER, TASK_ID_RE, WORKTREE_BRANCH_PREFIX, WORKTREE_DIR } from './constants';
import type { BridgeMsg, BridgeResult } from './types';

export function gitRun(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        execFile('git', args, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
            resolve({
                code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0,
                stdout: String(stdout), stderr: String(stderr),
            });
        });
    });
}

async function isGitRepo(cwd: string): Promise<boolean> {
    const r = await gitRun(['rev-parse', '--is-inside-work-tree'], cwd);
    return r.code === 0 && r.stdout.trim() === 'true';
}

/** worktree 디렉토리를 로컬 전용 제외 목록에 등록 — 사용자의 .gitignore 는 건드리지 않는다. */
function excludeWorktreeDir(gitDir: string): void {
    try {
        const infoDir = path.join(gitDir, 'info');
        fs.mkdirSync(infoDir, { recursive: true });
        const p = path.join(infoDir, 'exclude');
        const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
        if (!cur.split('\n').some((l) => l.trim() === '.openmake/')) {
            fs.appendFileSync(p, `${cur.endsWith('\n') || cur === '' ? '' : '\n'}.openmake/\n`);
        }
    } catch { /* 제외 등록 실패는 치명적이지 않다(사용자 status 에 보일 뿐) */ }
}

/**
 * diff 기준점(worktree 생성 시점 커밋) 저장·조회.
 *
 * worktree 메타 디렉토리(`.git/worktrees/<name>/`)에 둔다 — 작업트리 밖이라 diff·status 에
 * 잡히지 않고, `git worktree remove` 시 함께 정리된다. 읽기 실패 시 'HEAD' 로 폴백한다
 * (커밋이 있었다면 그 변경은 놓치지만, diff 캡처 자체가 죽지는 않는다).
 */
async function worktreeMetaDir(wtAbs: string): Promise<string | null> {
    const r = await gitRun(['rev-parse', '--absolute-git-dir'], wtAbs);
    return r.code === 0 ? r.stdout.trim() : null;
}

async function writeBaseSha(wtAbs: string): Promise<void> {
    try {
        const meta = await worktreeMetaDir(wtAbs);
        const head = await gitRun(['rev-parse', 'HEAD'], wtAbs);
        if (meta && head.code === 0) fs.writeFileSync(path.join(meta, 'omk-base'), head.stdout.trim());
    } catch { /* 기준점 기록 실패는 치명적이지 않다(HEAD 폴백) */ }
}

async function readBaseSha(wtAbs: string): Promise<string> {
    try {
        const meta = await worktreeMetaDir(wtAbs);
        const p = meta && path.join(meta, 'omk-base');
        if (p && fs.existsSync(p)) {
            const sha = fs.readFileSync(p, 'utf8').trim();
            if (/^[0-9a-f]{7,40}$/.test(sha)) return sha;
        }
    } catch { /* noop */ }
    return 'HEAD';
}

export async function handleWorktree(m: BridgeMsg, done: (r: BridgeResult) => void, base: string): Promise<void> {
    const taskId = String(m.taskId || '');
    if (!TASK_ID_RE.test(taskId)) { done({ ok: false, error: '잘못된 taskId 형식' }); return; }
    // 폴더 선택 시 worktree 도 base(선택 폴더) 하위에 만들고, worktreeRel 은 base 기준
    // 상대경로로 돌려준다 — 서버는 folder+worktreeRel 을 그대로 합성해 라우팅한다.
    const rel = `${WORKTREE_DIR}/${taskId}`;
    const abs = path.join(base, rel);
    const branch = `${WORKTREE_BRANCH_PREFIX}${taskId.slice(0, 8)}`;

    if (m.op === 'add') {
        if (!(await isGitRepo(base))) { done({ ok: false, error: 'git 레포가 아닙니다' }); return; }
        // worktree 는 **레포 전체**를 체크아웃한다. 연결 폴더가 레포 루트가 아니라 하위 디렉토리면
        // (예: 레포 /repo 를 두고 /repo/apps/web 을 연결) worktree 루트는 /repo 에 대응하므로,
        // 에이전트의 상대경로가 그대로면 다른 위치를 가리킨다. show-prefix 만큼 더 내려가 맞춘다.
        const prefixR = await gitRun(['rev-parse', '--show-prefix'], base);
        const sub = prefixR.code === 0 ? prefixR.stdout.trim().replace(/\/+$/, '') : '';
        const workRel = sub ? `${rel}/${sub}` : rel;
        // 연결/선택 폴더가 **untracked**(HEAD 에 없는) 하위 디렉토리면 worktree 체크아웃에
        // 해당 경로가 없어 exec cwd 가 ENOENT 로 실패한다 — 빈 디렉토리로 보장한다.
        // (worktree 는 어차피 tracked 내용만 담으므로 격리 의미는 동일: 빈 폴더에서 시작.)
        const ensureSub = (): void => {
            if (sub) { try { fs.mkdirSync(path.join(abs, sub), { recursive: true }); } catch { /* exec 가 후속 실패로 노출 */ } }
        };
        const gitDirR = await gitRun(['rev-parse', '--absolute-git-dir'], base);
        if (gitDirR.code === 0) excludeWorktreeDir(gitDirR.stdout.trim());
        if (fs.existsSync(abs)) { ensureSub(); done({ ok: true, worktreeRel: workRel, branch }); return; } // 재개 시 재사용
        const r = await gitRun(['worktree', 'add', abs, '-b', branch], base);
        if (r.code !== 0) { done({ ok: false, error: `worktree 생성 실패: ${(r.stderr || r.stdout).trim().slice(0, 300)}` }); return; }
        await writeBaseSha(abs);
        ensureSub();
        done({ ok: true, worktreeRel: workRel, branch });
        return;
    }

    if (m.op === 'diff') {
        if (!fs.existsSync(abs)) { done({ ok: false, error: 'worktree 없음' }); return; }
        // -N: 새 파일을 인덱스에 '의도만' 등록해 diff 에 포함시킨다(실제 스테이징·커밋은 하지 않음).
        await gitRun(['add', '-A', '-N', '.'], abs);
        // 기준점은 **worktree 생성 시점의 커밋**이다. HEAD 를 쓰면 에이전트가 중간에 커밋했을 때
        // 그 변경이 diff 에서 사라진다(2026-08-09 라이브 E2E 에서 실제 발생 — 모델이 작업을 커밋해
        // diff 에 마지막 미커밋 파일 하나만 남았다).
        const r = await gitRun(['diff', await readBaseSha(abs)], abs);
        if (r.code !== 0) { done({ ok: false, error: `diff 실패: ${(r.stderr || '').trim().slice(0, 200)}` }); return; }
        done({ ok: true, stdout: r.stdout, branch });
        return;
    }

    if (m.op === 'remove') {
        if (!fs.existsSync(abs)) { done({ ok: true, kept: false }); return; }
        // 변경분이 남아 있으면 **지우지 않는다** — 사용자 디스크의 작업 결과를 임의 삭제하지 않는다.
        // 미커밋 변경뿐 아니라 **에이전트가 만든 커밋**도 보존 대상이다(HEAD 가 기준점에서 움직였는지).
        const st = await gitRun(['status', '--porcelain'], abs);
        const head = await gitRun(['rev-parse', 'HEAD'], abs);
        const moved = head.code === 0 && head.stdout.trim() !== (await readBaseSha(abs));
        if ((st.code === 0 && st.stdout.trim() !== '') || moved) { done({ ok: true, kept: true, branch }); return; }
        const r = await gitRun(['worktree', 'remove', '--force', abs], base);
        if (r.code !== 0) { done({ ok: true, kept: true, branch }); return; } // 제거 실패도 보존으로 취급
        await gitRun(['branch', '-D', branch], base); // 변경 없는 빈 브랜치 정리(실패 무시)
        done({ ok: true, kept: false, branch });
        return;
    }

    done({ ok: false, error: `지원하지 않는 worktree op: ${m.op}` });
}
