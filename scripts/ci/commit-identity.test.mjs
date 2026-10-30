import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedIdentity, checkIdentities } from './commit-identity.mjs';

test('허용: GitHub noreply·웹 머지·봇 주소', () => {
    for (const e of ['3861760+riskpw@users.noreply.github.com', 'riskpw@users.noreply.github.com', 'noreply@github.com',
        '41898282+github-actions[bot]@users.noreply.github.com', 'noreply@anthropic.com']) assert.equal(isAllowedIdentity(e), true, e);
});

test('거부: 그 밖의 모든 주소', () => {
    const j = (...p) => p.join('');
    for (const e of [j('me@gm', 'ail.com'), 'dev@example.com', 'someone@corp.example', '', 'x@users.noreply.github.com.evil']) assert.equal(isAllowedIdentity(e), false, e);
});

test('검사 결과는 커밋 SHA 와 어느 쪽(작성자·커미터)인지만 싣고 주소는 싣지 않는다', () => {
    const j = (...p) => p.join('');
    const rows = [
        { sha: 'aaaaaaaaaaaa', author: 'riskpw@users.noreply.github.com', committer: 'noreply@github.com' },
        { sha: 'bbbbbbbbbbbb', author: j('me@na', 'ver.com'), committer: 'riskpw@users.noreply.github.com' },
        { sha: 'cccccccccccc', author: 'riskpw@users.noreply.github.com', committer: j('me@na', 'te.com') },
    ];
    assert.deepEqual(checkIdentities(rows), [{ sha: 'bbbbbbbbbbbb', field: 'author' }, { sha: 'cccccccccccc', field: 'committer' }]);
});
