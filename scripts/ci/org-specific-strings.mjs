#!/usr/bin/env node
/**
 * 환경 고유 정보(조직의 서버·계정·주소)가 저장소에 들어오지 않게 막는다.
 *
 * 범용 규칙(테일넷·DDNS 주소, 가상 이름이 아닌 홈·볼륨 경로)은 여기 두고, 조직 고유 값은 저장소 밖에서
 * 받는다 — `OMK_FORBIDDEN_STRINGS`(쉼표 구분, CI 는 저장소 비밀값). 목록 자체가 저장소에 남으면 그것이 유출이다.
 * 걸린 비밀값은 값 대신 번호로만 보고한다(공개 저장소의 CI 로그는 누구나 읽는다).
 *
 *   node scripts/ci/org-specific-strings.mjs            # 추적 파일 전체, 걸리면 exit 1
 *
 * 제외: 루트 README(프로젝트 공식 안내), CHANGELOG(릴리스 이력), package-lock, 적용된 마이그레이션(내용을 바꾸지 않는다).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXCLUDE = [/^README(\.[A-Za-z-]+)?\.md$/, /^CHANGELOG\.md$/, /(^|\/)package-lock\.json$/, /^db\/migrations\//];

// 테스트·문서의 가상 이름은 허용한다 — 실제 계정·볼륨 이름만 잡는다.
const PLACEHOLDER = /^(alice|bob|kim|me|you|user|users|username|name|foo|test|runner|ubuntu|node|External|Data|App|APP|USER|<user>|[A-Za-z]|\.+)$/;

export const RULES = [
    { id: 'tailnet-host', re: /\b[a-z0-9-]+\.ts\.net\b/gi },
    { id: 'ddns-host', re: /\b[a-z0-9-]+\.(?:tplinkdns\.com|duckdns\.org|ddns\.net|no-ip\.(?:com|org|biz))\b/gi },
    // 이름 자리는 `<user>` 같은 꺾쇠 자리표시를 통째로 잡는다. 글롭·변수(`*`·`$`·`{`)가 섞인 경로는 실제 계정이 아니다.
    { id: 'personal-path', re: /\/(?:home|Users|Volumes)\/(<[^>\s]+>|[^/\s'"`)\]}<>,;:]+)/g, allow: (m) => PLACEHOLDER.test(m[1]) || /[*${]|^</.test(m[1]) },
];

/** 쉼표 구분 목록 → 비어 있지 않은 문자열들(앞뒤 공백 제거) */
export function parseForbidden(raw) {
    return String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** text 에서 걸린 것 — { rule, line }. 비밀값은 rule 이 `forbidden#<번호>` 이고 값은 싣지 않는다. */
export function scanText(text, forbidden = []) {
    const hits = [];
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        for (const r of RULES) {
            for (const m of line.matchAll(r.re)) {
                if (!r.allow || !r.allow(m)) hits.push({ rule: r.id, line: i + 1, match: m[0] });
            }
        }
        const lower = line.toLowerCase();
        forbidden.forEach((s, k) => {
            if (lower.includes(s.toLowerCase())) hits.push({ rule: `forbidden#${k + 1}`, line: i + 1 });
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
    const hits = scanRepo(root, forbidden);
    for (const h of hits) console.log(`${h.file}:${h.line}  ${h.rule}${h.match ? `  ${h.match}` : ''}`);
    console.log(`환경 고유 정보 검사: ${hits.length}건 (조직 목록 ${forbidden.length}개${forbidden.length ? '' : ' — OMK_FORBIDDEN_STRINGS 없음, 범용 규칙만'})`);
    process.exit(hits.length ? 1 : 0);
}
