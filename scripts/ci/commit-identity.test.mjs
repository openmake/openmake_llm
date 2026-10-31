import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedIdentity, checkIdentities } from './commit-identity.mjs';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('허용: GitHub noreply·웹 머지·봇 주소', () => {
    for (const e of ['12345+octocat@users.noreply.github.com', 'octocat@users.noreply.github.com', 'noreply@github.com',
        '41898282+github-actions[bot]@users.noreply.github.com', 'noreply@anthropic.com']) assert.equal(isAllowedIdentity(e), true, e);
});

test('거부: 그 밖의 모든 주소', () => {
    const j = (...p) => p.join('');
    for (const e of [j('me@gm', 'ail.com'), 'dev@example.com', 'someone@corp.example', '', 'x@users.noreply.github.com.evil']) assert.equal(isAllowedIdentity(e), false, e);
});

test('검사 결과는 커밋 SHA 와 어느 쪽(작성자·커미터)인지만 싣고 주소는 싣지 않는다', () => {
    const j = (...p) => p.join('');
    const rows = [
        { sha: 'aaaaaaaaaaaa', author: 'octocat@users.noreply.github.com', committer: 'noreply@github.com' },
        { sha: 'bbbbbbbbbbbb', author: j('me@na', 'ver.com'), committer: 'octocat@users.noreply.github.com' },
        { sha: 'cccccccccccc', author: 'octocat@users.noreply.github.com', committer: j('me@na', 'te.com') },
    ];
    assert.deepEqual(checkIdentities(rows), [{ sha: 'bbbbbbbbbbbb', field: 'author' }, { sha: 'cccccccccccc', field: 'committer' }]);
});

test('트레일러(Signed-off-by·Co-authored-by) 주소와 조직 목록에 걸린 이름도 본다 — 값은 싣지 않는다', () => {
    const j = (...p) => p.join('');
    const ok = 'octocat@users.noreply.github.com';
    const rows = [
        { sha: 'dddddddddddd', author: ok, committer: ok, body: j('fix\n\nSigned-off-by: A <a@gm', 'ail.com>'), authorName: 'octocat', committerName: 'GitHub' },
        { sha: 'eeeeeeeeeeee', author: ok, committer: ok, body: 'x\n\nCo-Authored-By: Bot <noreply@anthropic.com>', authorName: 'Real Person', committerName: 'GitHub' },
    ];
    assert.deepEqual(checkIdentities(rows, ['real person']), [{ sha: 'dddddddddddd', field: 'trailer' }, { sha: 'eeeeeeeeeeee', field: 'name' }]);
});

test('트레일러 주소 뽑기: 대소문자 무관, 꺾쇠 안 주소만', async () => {
    const { trailerEmails } = await import('./commit-identity.mjs');
    assert.deepEqual(trailerEmails('t\n\nsigned-off-by: A <a@x.example>\nCo-authored-by: B <b@y.example>\nSee-also: <c@z.example>'), ['a@x.example', 'b@y.example']);
});

test('dependabot 의 GitHub 주소 트레일러는 허용한다', () => {
    const rows = [{ sha: 'ffffffffffff', author: '49699333+dependabot[bot]@users.noreply.github.com', committer: 'noreply@github.com',
        body: 'chore(deps): bump x\n\nSigned-off-by: dependabot[bot] <support@github.com>', authorName: 'dependabot[bot]', committerName: 'GitHub' }];
    assert.deepEqual(checkIdentities(rows, ['real person']), []);
});

test('트레일러의 이름 자리도 조직 목록과 대조한다', () => {
    const ok = 'octocat@users.noreply.github.com';
    const rows = [{ sha: '111111111111', author: ok, committer: ok, body: 'x\n\nCo-authored-by: Real Person <octocat@users.noreply.github.com>', authorName: 'octocat', committerName: 'octocat' }];
    assert.deepEqual(checkIdentities(rows, ['real person']), [{ sha: '111111111111', field: 'trailer' }]);
});

// ─── --exclude: main 에 이미 있는 커밋은 dev 쪽 검사에서 뺀다 ───

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commit-identity.mjs');
const OK = '1+octocat@users.noreply.github.com';

/** main 에 허용 안 되는 메일 커밋 → dev 로 병합한 임시 저장소. before 는 병합 전 dev 끝 */
function mainMergedIntoDev() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'commit-identity-'));
    const git = (email, ...args) => execFileSync('git', ['-c', `user.email=${email}`, '-c', 'user.name=octocat', '-c', 'commit.gpgsign=false', ...args],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const commit = (email, file) => { writeFileSync(path.join(dir, file), file); git(email, 'add', file); git(email, 'commit', '-q', '-m', file); };
    git(OK, 'init', '-q', '-b', 'main');
    commit(OK, 'a');
    git(OK, 'branch', 'dev');
    commit('dev@example.com', 'b');            // 검사 도입 전 main 에 남은 옛 메일 커밋
    git(OK, 'switch', '-q', 'dev');
    commit(OK, 'c');
    const before = git(OK, 'rev-parse', 'HEAD');
    git(OK, 'merge', '-q', '--no-ff', '-m', 'Merge branch main into dev', 'main');
    return { dir, before };
}

function run(dir, ...args) {
    const env = { ...process.env, OMK_FORBIDDEN_STRINGS: '' };
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env });
}

test('--exclude main: main→dev 병합이 끌어온 main 커밋은 dev 검사에서 빠진다', (t) => {
    const { dir, before } = mainMergedIntoDev();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.equal(run(dir, before, 'dev').status, 1, '제외 없으면 main 의 옛 메일 커밋에 걸린다');
    const r = run(dir, before, 'dev', '--exclude', 'main');
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /main 에 이미 있는 1커밋 제외/);
    assert.doesNotMatch(r.stdout, /example\.com/);
});

test('--exclude 빈 값은 무시한다(CI 가 main 대상일 때 빈 env 를 넘긴다)', (t) => {
    const { dir, before } = mainMergedIntoDev();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.equal(run(dir, before, 'dev', '--exclude', '').status, 1);
});

test('--exclude ref 가 이 체크아웃에 없으면 이유를 알리고 exit 1', (t) => {
    const { dir, before } = mainMergedIntoDev();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const r = run(dir, before, 'dev', '--exclude', 'origin/nope');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /제외 기준\(origin\/nope\)이 이 체크아웃에 없다/);
});
