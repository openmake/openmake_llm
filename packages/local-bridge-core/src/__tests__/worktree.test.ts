/**
 * worktree 격리 — 실제 git 레포(tmpdir)로 add/diff/remove 수명주기와 보존 규칙을 검증.
 * diff 기준점(omk-base)이 '생성 시점 커밋'인 것이 핵심 — HEAD 기준이면 에이전트가 중간에
 * 커밋한 변경이 diff 에서 사라진다(2026-08-09 라이브에서 실제 발생했던 결함의 회귀 가드).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { handleWorktree } from '../worktree';
import type { BridgeMsg, BridgeResult } from '../types';

const TASK = 'aaaabbbb-1111-2222-3333-444455556666';

function git(args: string[], cwd: string): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function run(m: BridgeMsg, base: string): Promise<BridgeResult> {
    return new Promise((resolve) => { void handleWorktree(m, resolve, base); });
}

describe('handleWorktree', () => {
    let repo: string;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-wt-'));
        git(['init', '-q'], repo);
        git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'init'], repo);
        fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
        git(['add', '.'], repo);
        git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base'], repo);
    });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    it('잘못된 taskId(경로·옵션 주입)는 거부한다', async () => {
        const r = await run({ kind: 'worktree', op: 'add', taskId: '../evil' }, repo);
        expect(r.ok).toBe(false);
        expect(r.error).toContain('taskId');
    });

    it('add: worktree 생성 + 브랜치 + info/exclude 등록 + 재호출 재사용', async () => {
        const r = await run({ kind: 'worktree', op: 'add', taskId: TASK }, repo);
        expect(r.ok).toBe(true);
        expect(r.worktreeRel).toBe(`.openmake/worktrees/${TASK}`);
        expect(r.branch).toBe(`omk-task/${TASK.slice(0, 8)}`);
        expect(fs.existsSync(path.join(repo, r.worktreeRel!))).toBe(true);
        expect(fs.readFileSync(path.join(repo, '.git/info/exclude'), 'utf8')).toContain('.openmake/');
        // 사용자 status 오염 없음
        expect(git(['status', '--porcelain'], repo).trim()).toBe('');
        // 재개 시 재사용 (같은 worktreeRel, 실패 아님)
        const again = await run({ kind: 'worktree', op: 'add', taskId: TASK }, repo);
        expect(again.ok).toBe(true);
        expect(again.worktreeRel).toBe(r.worktreeRel);
    });

    it('diff: 에이전트가 중간 커밋해도 생성 시점 기준(omk-base)으로 잡힌다', async () => {
        const add = await run({ kind: 'worktree', op: 'add', taskId: TASK }, repo);
        const wt = path.join(repo, add.worktreeRel!);
        fs.writeFileSync(path.join(wt, 'a.txt'), 'v2\n');
        git(['add', '.'], wt);
        git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'agent commit'], wt);
        fs.writeFileSync(path.join(wt, 'new.txt'), 'brand new\n'); // 미커밋 신규 파일
        const d = await run({ kind: 'worktree', op: 'diff', taskId: TASK }, repo);
        expect(d.ok).toBe(true);
        expect(d.stdout).toContain('v2');       // 커밋된 변경도 포함 (HEAD 기준이면 사라짐)
        expect(d.stdout).toContain('brand new'); // -N 로 신규 파일 포함
    });

    it('remove: 변경 없으면 정리(kept=false), 변경·커밋 있으면 보존(kept=true)', async () => {
        const add = await run({ kind: 'worktree', op: 'add', taskId: TASK }, repo);
        const wt = path.join(repo, add.worktreeRel!);
        // 변경 없음 → 제거 + 브랜치 정리
        const clean = await run({ kind: 'worktree', op: 'remove', taskId: TASK }, repo);
        expect(clean).toMatchObject({ ok: true, kept: false });
        expect(fs.existsSync(wt)).toBe(false);
        // 다시 만들고 커밋 → 보존
        const add2 = await run({ kind: 'worktree', op: 'add', taskId: TASK.replace('aaaa', 'cccc') }, repo);
        const wt2 = path.join(repo, add2.worktreeRel!);
        fs.writeFileSync(path.join(wt2, 'a.txt'), 'v3\n');
        git(['add', '.'], wt2);
        git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'work'], wt2);
        const kept = await run({ kind: 'worktree', op: 'remove', taskId: TASK.replace('aaaa', 'cccc') }, repo);
        expect(kept).toMatchObject({ ok: true, kept: true });
        expect(fs.existsSync(wt2)).toBe(true); // 사용자 작업 결과를 임의 삭제하지 않는다
    });

    it('레포 하위 폴더 base: show-prefix 만큼 내려간 worktreeRel 을 돌려준다', async () => {
        const sub = path.join(repo, 'apps', 'web');
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(sub, 'x.txt'), 'x\n');
        git(['add', '.'], repo);
        git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'sub'], repo);
        const r = await run({ kind: 'worktree', op: 'add', taskId: TASK }, sub);
        expect(r.ok).toBe(true);
        expect(r.worktreeRel).toBe(`.openmake/worktrees/${TASK}/apps/web`);
    });

    it('git 레포가 아니면 add 를 거부한다', async () => {
        const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-plain-'));
        try {
            const r = await run({ kind: 'worktree', op: 'add', taskId: TASK }, plain);
            expect(r.ok).toBe(false);
            expect(r.error).toContain('git 레포가 아닙니다');
        } finally { fs.rmSync(plain, { recursive: true, force: true }); }
    });
});
