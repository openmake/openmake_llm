#!/usr/bin/env node
/**
 * 커밋에 개인 주소·실명이 들어오지 않게 막는다 — 작성자·커미터 메일, Signed-off-by·Co-authored-by 트레일러,
 * 그리고 조직 목록(`OMK_FORBIDDEN_STRINGS`, 저장소 비밀값)에 걸린 작성자·커미터 이름.
 *
 * 허용 메일: GitHub noreply(`<id>+<login>@users.noreply.github.com`·`<login>@users.noreply.github.com`),
 *            GitHub 웹 머지(`noreply@github.com`), 공동 작성 표기용 `noreply@anthropic.com`.
 * 공개 저장소의 CI 로그는 누구나 읽으므로 걸린 값은 출력하지 않고 커밋 SHA 와 자리만 알린다.
 * CI 는 이미 올라간 커밋을 보는 백스톱이다 — 기록 자체를 막는 첫 관문은 GitHub 계정의
 * "Block command line pushes that expose my email" 설정과 로컬 `npm run check:commit-identity` 다.
 *
 *   node scripts/ci/commit-identity.mjs <base-ref|sha> <head>   # merge-base(base, head)..head, 걸리면 exit 1
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

/** 커밋 본문의 Signed-off-by·Co-authored-by 트레일러에 적힌 주소들 */
export function trailerEmails(body) {
    const out = [];
    for (const m of String(body ?? '').matchAll(/^(?:signed-off-by|co-authored-by):[^<\n]*<([^>\n]+)>/gim)) out.push(m[1].trim());
    return out;
}

/** rows: { sha, author, committer, body?, authorName?, committerName? }[] → 걸린 { sha, field }[] (값은 싣지 않는다) */
export function checkIdentities(rows, forbiddenNames = []) {
    const names = forbiddenNames.map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 4);
    const out = [];
    for (const r of rows) {
        for (const field of ['author', 'committer']) {
            if (!isAllowedIdentity(r[field])) out.push({ sha: r.sha, field });
        }
        if (trailerEmails(r.body).some((e) => !isAllowedIdentity(e))) out.push({ sha: r.sha, field: 'trailer' });
        const who = [r.authorName, r.committerName].map((s) => String(s ?? '').toLowerCase());
        if (names.some((n) => who.some((w) => w.includes(n)))) out.push({ sha: r.sha, field: 'name' });
    }
    return out;
}

const FIELD_KO = { author: '작성자 메일', committer: '커미터 메일', trailer: '트레일러 메일', name: '작성자·커미터 이름' };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const [base, head = 'HEAD'] = process.argv.slice(2);
    if (!base) {
        console.log('사용: node scripts/ci/commit-identity.mjs <base-ref|sha> [head]');
        process.exit(2);
    }
    let start;
    try {
        start = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        console.log(`기준 커밋을 찾지 못했다(${base}) — 브랜치를 origin/dev 위로 rebase 한 뒤 다시 push 한다`);
        process.exit(1);
    }
    const raw = execFileSync('git', ['log', '-z', '--format=%H%x1f%ae%x1f%ce%x1f%an%x1f%cn%x1f%B', `${start}..${head}`], { encoding: 'utf8' });
    const rows = raw.split('\0').filter((s) => s.trim()).map((rec) => {
        const [sha, author, committer, authorName, committerName, body] = rec.replace(/^\n/, '').split('\x1f');
        return { sha, author, committer, authorName, committerName, body };
    });
    const forbidden = String(process.env.OMK_FORBIDDEN_STRINGS ?? '').split(/[,\n]/);
    const bad = checkIdentities(rows, forbidden);
    for (const b of bad) console.log(`${b.sha.slice(0, 12)}  ${FIELD_KO[b.field]}이 허용되지 않는다`);
    console.log(`커밋 신원 검사: ${rows.length}커밋 중 ${bad.length}건`);
    if (bad.length) {
        console.log('고치는 법: git config user.email <id>+<login>@users.noreply.github.com, git config user.name <login> 뒤');
        console.log(`  git rebase ${start.slice(0, 12)} --exec 'git commit --amend --no-edit --reset-author' (트레일러는 메시지에서 직접 고친다)`);
    }
    process.exit(bad.length ? 1 : 0);
}
