#!/usr/bin/env node
/**
 * 커밋에 개인 주소·실명이 들어오지 않게 막는다 — 작성자·커미터 메일, Signed-off-by·Co-authored-by 트레일러,
 * 그리고 조직 목록(`OMK_FORBIDDEN_STRINGS`, 저장소 비밀값)에 걸린 작성자·커미터 이름.
 *
 * 허용 메일: GitHub noreply(`<id>+<login>@users.noreply.github.com`·`<login>@users.noreply.github.com`),
 *            GitHub 웹 머지(`noreply@github.com`), 공동 작성 표기용 `noreply@anthropic.com`.
 * 공개 저장소의 CI 로그는 누구나 읽으므로 걸린 값은 출력하지 않고 커밋 SHA 와 자리만 알린다.
 * CI 는 이미 올라간 커밋을 사후에 잡는 검출이다 — 기록 자체를 막는 것은 GitHub 계정의
 * "Block command line pushes that expose my email" 설정이고, push 전에는 `npm run check:commit-identity` 를 손으로 돌린다.
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
    /^support@github\.com$/,   // dependabot 의 Signed-off-by 트레일러
];

export function isAllowedIdentity(email) {
    return ALLOWED.some((re) => re.test(String(email ?? '')));
}

const TRAILER = /^(?:signed-off-by|co-authored-by):([^<\n]*)<([^>\n]+)>/gim;

/** 커밋 본문의 Signed-off-by·Co-authored-by 트레일러에 적힌 주소들 */
export function trailerEmails(body) {
    return [...String(body ?? '').matchAll(TRAILER)].map((m) => m[2].trim());
}

/** 같은 트레일러의 이름 자리 */
export function trailerNames(body) {
    return [...String(body ?? '').matchAll(TRAILER)].map((m) => m[1].trim());
}

/** rows: { sha, author, committer, body?, authorName?, committerName? }[] → 걸린 { sha, field }[] (값은 싣지 않는다) */
export function checkIdentities(rows, forbiddenNames = []) {
    const names = forbiddenNames.map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 4);
    const out = [];
    for (const r of rows) {
        for (const field of ['author', 'committer']) {
            if (!isAllowedIdentity(r[field])) out.push({ sha: r.sha, field });
        }
        const trailerNameHit = trailerNames(r.body).some((t) => names.some((n) => t.toLowerCase().includes(n)));
        if (trailerNameHit || trailerEmails(r.body).some((e) => !isAllowedIdentity(e))) out.push({ sha: r.sha, field: 'trailer' });
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
        let known = true;
        try { execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { stdio: 'ignore' }); } catch { known = false; }
        console.log(known
            ? `기준(${base})과 공통 조상이 없다 — 브랜치를 origin/dev 위로 rebase 한 뒤 다시 push 한다`
            : `기준 커밋(${base})이 이 체크아웃에 없다 — force-push 로 이력이 바뀐 경우면 그 push 는 검사 범위를 정할 수 없다`);
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
