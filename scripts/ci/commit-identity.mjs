#!/usr/bin/env node
/**
 * 커밋 작성자·커미터 메일에 개인 주소가 들어오지 않게 막는다.
 *
 * 허용: GitHub noreply(`<id>+<login>@users.noreply.github.com`·`<login>@users.noreply.github.com`),
 *       GitHub 웹 머지(`noreply@github.com`), 공동 작성 표기용 `noreply@anthropic.com`.
 * 공개 저장소의 CI 로그는 누구나 읽으므로 걸린 주소는 출력하지 않고 커밋 SHA 와 자리(작성자·커미터)만 알린다.
 *
 *   node scripts/ci/commit-identity.mjs <base> <head>     # base..head 커밋, 걸리면 exit 1
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED = [
    /^(?:\d+\+)?[A-Za-z0-9-]+(?:\[bot\])?@users\.noreply\.github\.com$/,
    /^noreply@github\.com$/,
    /^noreply@anthropic\.com$/,
];

export function isAllowedIdentity(email) {
    return ALLOWED.some((re) => re.test(String(email ?? '')));
}

/** rows: { sha, author, committer }[] → 걸린 { sha, field }[] (주소는 싣지 않는다) */
export function checkIdentities(rows) {
    const out = [];
    for (const r of rows) {
        for (const field of ['author', 'committer']) {
            if (!isAllowedIdentity(r[field])) out.push({ sha: r.sha, field });
        }
    }
    return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const [base, head] = process.argv.slice(2);
    if (!base || !head) {
        console.log('사용: node scripts/ci/commit-identity.mjs <base> <head>');
        process.exit(2);
    }
    const raw = execFileSync('git', ['log', '--format=%H%x09%ae%x09%ce', `${base}..${head}`], { encoding: 'utf8' });
    const rows = raw.split('\n').filter(Boolean).map((l) => {
        const [sha, author, committer] = l.split('\t');
        return { sha, author, committer };
    });
    const bad = checkIdentities(rows);
    for (const b of bad) console.log(`${b.sha.slice(0, 12)}  ${b.field === 'author' ? '작성자' : '커미터'} 메일이 GitHub noreply 가 아니다`);
    console.log(`커밋 신원 검사: ${rows.length}커밋 중 ${bad.length}건 — 고치는 법: git config user.email <id>+<login>@users.noreply.github.com 후 git commit --amend --reset-author`);
    process.exit(bad.length ? 1 : 0);
}
