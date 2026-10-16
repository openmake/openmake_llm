/**
 * add-on → Base 내부 import 경계 검사 (결정 D2 ratchet) — CI Gate 4.
 *
 * 허용 목록에 없는 (파일, 대상) 쌍이 하나라도 있으면 실패한다. 목록에 있는데 코드에서 사라진 쌍은 실패가 아니라
 * "목록을 줄이라" 는 권고로 알린다(npm run gen:addon-boundary).
 *
 * 사용: npm run check:addon-boundary
 * @module scripts/lint/check-addon-boundary
 */
import { existsSync, readFileSync } from 'node:fs';
import { ALLOWLIST_PATH, REPO_ROOT, collectAddonBaseImports, countPairs, diffAllowlist } from './addon-boundary-lib.mjs';

function main() {
    if (!existsSync(ALLOWLIST_PATH)) {
        console.error('허용 목록 파일이 없습니다: scripts/lint/addon-import-allowlist.json — npm run gen:addon-boundary 로 만드세요');
        return 1;
    }
    const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).entries ?? {};
    const current = collectAddonBaseImports(REPO_ROOT);
    const { added, removed } = diffAllowlist(allowlist, current);
    console.log(`add-on → Base 내부 import: ${countPairs(current)}쌍 / ${Object.keys(current).length}파일 (허용 목록 ${countPairs(allowlist)}쌍)`);
    if (removed.length > 0) {
        console.log(`허용 목록에서 지울 수 있는 항목 ${removed.length}개 — npm run gen:addon-boundary 로 목록을 줄이세요:`);
        for (const line of removed) console.log(`  - ${line}`);
    }
    if (added.length > 0) {
        console.error(`허용 목록 밖의 새 add-on → Base 내부 import ${added.length}개 — runtime-ports 의 포트나 @openmake/plugin-contracts 를 거치세요:`);
        for (const line of added) console.error(`  + ${line}`);
        return 1;
    }
    console.log('add-on 경계 검사 통과');
    return 0;
}

process.exitCode = main();
