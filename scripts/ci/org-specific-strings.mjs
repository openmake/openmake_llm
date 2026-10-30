#!/usr/bin/env node
/**
 * 환경 고유 정보(조직의 서버·계정·주소)가 저장소에 들어오지 않게 막는다.
 *
 * 범용 규칙(테일넷·DDNS 주소, 가상 이름이 아닌 홈·볼륨 경로)은 여기 두고, 조직 고유 값은 저장소 밖에서
 * 받는다 — `OMK_FORBIDDEN_STRINGS`(쉼표·줄바꿈 구분, CI 는 저장소 비밀값). 목록 자체가 저장소에 남으면 그것이 유출이다.
 * 걸린 비밀값은 값 대신 번호로만 보고한다(공개 저장소의 CI 로그는 누구나 읽는다).
 * 조직 목록은 앞뒤가 영숫자가 아닐 때만 일치한다(단어 경계) — `.`·`@`·`-` 는 경계라 도메인·메일·하이픈 이름은 그대로 잡힌다.
 * 3자 이하 항목은 정상 단어에 섞여 오탐이 나므로 검사하지 않고, 번호와 이유만 출력한다.
 *
 *   node scripts/ci/org-specific-strings.mjs            # 추적 파일 전체, 걸리면 exit 1
 *
 * 제외: 루트 README(프로젝트 공식 안내), CHANGELOG(릴리스 이력), package-lock, 적용된 마이그레이션(내용을 바꾸지 않는다 —
 *       현재 마지막 번호 195 이하와 그 rollback 만. 새 마이그레이션은 검사한다).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXCLUDE = [/^README(\.[A-Za-z-]+)?\.md$/, /^CHANGELOG\.md$/, /(^|\/)package-lock\.json$/, /^db\/migrations\/(?:rollbacks\/)?(?:0\d\d|1[0-8]\d|19[0-5])_[^/]*\.sql$/];

// 테스트·문서의 가상 이름은 허용한다 — 실제 계정·볼륨 이름만 잡는다.
const PLACEHOLDER = /^(alice|bob|kim|me|you|user|users|username|name|foo|test|runner|ubuntu|node|External|Data|App|APP|USER|<user>|[A-Za-z]|\.+)$/;

export const RULES = [
    { id: 'tailnet-host', re: /\b[a-z0-9-]+\.ts\.net\b/gi },
    { id: 'ddns-host', re: /\b[a-z0-9-]+\.(?:tplinkdns\.com|duckdns\.org|ddns\.net|no-ip\.(?:com|org|biz))\b/gi },
    // 이름 자리는 `<user>` 같은 꺾쇠 자리표시를 통째로 잡는다. 글롭·변수(`*`·`$`·`{`)가 섞인 경로는 실제 계정이 아니다.
    { id: 'personal-path', re: /\/(?:home|Users|Volumes)\/(<[^>\s]+>|[^/\s'"`)\]}<>,;:]+)/g, allow: (m) => PLACEHOLDER.test(m[1]) || /[*${]|^</.test(m[1]) },
];

/** 쉼표·줄바꿈 구분 목록 → 비어 있지 않은 문자열들(앞뒤 공백 제거) */
export function parseForbidden(raw) {
    return String(raw ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

/** 이 길이 미만(3자 이하) 항목은 검사하지 않는다 */
export const MIN_FORBIDDEN_LENGTH = 4;

/** 검사하지 않는 짧은 항목의 번호(1부터, forbidden#<번호> 와 같은 번호) */
export function shortForbidden(forbidden) {
    return forbidden.flatMap((s, k) => (s.length < MIN_FORBIDDEN_LENGTH ? [k + 1] : []));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** text 에서 걸린 것 — { rule, line }. 비밀값은 rule 이 `forbidden#<번호>` 이고 값은 싣지 않는다. */
export function scanText(text, forbidden = []) {
    const hits = [];
    // 앞뒤가 영숫자가 아닐 때만 일치(항목 끝 글자가 영숫자인 쪽만 경계를 본다 — `@corp.example` 같은 항목도 잡힌다).
    // 짧은 항목은 건너뛰되 번호는 그대로 둔다.
    const patterns = forbidden.map((s) => {
        if (s.length < MIN_FORBIDDEN_LENGTH) return null;
        const lead = /^[A-Za-z0-9]/.test(s) ? '(?<![A-Za-z0-9])' : '';
        const trail = /[A-Za-z0-9]$/.test(s) ? '(?![A-Za-z0-9])' : '';
        return new RegExp(`${lead}${escapeRe(s)}${trail}`, 'i');
    });
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        for (const r of RULES) {
            for (const m of line.matchAll(r.re)) {
                if (!r.allow || !r.allow(m)) hits.push({ rule: r.id, line: i + 1, match: m[0] });
            }
        }
        patterns.forEach((re, k) => {
            if (re && re.test(line)) hits.push({ rule: `forbidden#${k + 1}`, line: i + 1 });
        });
    });
    return hits;
}

export function scanRepo(root, forbidden = []) {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    const out = [];
    for (const f of files) {
        if (EXCLUDE.some((re) => re.test(f))) continue;
        let buf;
        try { buf = readFileSync(path.join(root, f)); } catch { continue; }   // 지운 파일·서브모듈
        if (buf.includes(0)) continue;   // 바이너리
        for (const h of scanText(buf.toString('utf8'), forbidden)) out.push({ file: f, ...h });
    }
    return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const forbidden = parseForbidden(process.env.OMK_FORBIDDEN_STRINGS);
    for (const n of shortForbidden(forbidden)) console.log(`조직 목록 #${n}: ${MIN_FORBIDDEN_LENGTH - 1}자 이하 항목은 정상 단어에 섞여 오탐이 나므로 검사하지 않는다 — 도메인·전체 이름처럼 더 긴 값으로 바꾼다`);
    const hits = scanRepo(root, forbidden);
    for (const h of hits) console.log(`${h.file}:${h.line}  ${h.rule}${h.match ? `  ${h.match}` : ''}`);
    console.log(`환경 고유 정보 검사: ${hits.length}건 (조직 목록 ${forbidden.length}개${forbidden.length ? '' : ' — OMK_FORBIDDEN_STRINGS 없음, 범용 규칙만'})`);
    process.exit(hits.length ? 1 : 0);
}
