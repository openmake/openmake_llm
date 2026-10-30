import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedIdentity, checkIdentities } from './commit-identity.mjs';

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
