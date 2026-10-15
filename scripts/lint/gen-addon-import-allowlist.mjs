/**
 * add-on → Base 내부 import 허용 목록(scripts/lint/addon-import-allowlist.json)을 현재 코드에서 다시 만든다 (결정 D2 ratchet).
 *
 * 쓰는 때: ① 처음 만들 때 ② 위반을 **없앤 뒤** 목록을 줄일 때(check 가 "지울 수 있는 항목" 을 알려 준다).
 * 새 위반을 목록에 넣으려고 돌리지 않는다 — 목록이 늘어난 diff 는 리뷰에서 거절한다.
 *
 * 사용: npm run gen:addon-boundary
 * @module scripts/lint/gen-addon-import-allowlist
 */
import { writeFileSync } from 'node:fs';
import { ALLOWLIST_PATH, REPO_ROOT, collectAddonBaseImports, countPairs } from './addon-boundary-lib.mjs';

const entries = collectAddonBaseImports(REPO_ROOT);
const doc = {
    description: 'apps/api/src/addons/** → Base 내부 계층(data·services·routes·sockets·controllers·middlewares·auth·chat) import 허용 목록. 줄어들기만 한다(ratchet). 새 import 는 runtime-ports 의 포트나 @openmake/plugin-contracts 를 거친다. 재생성: npm run gen:addon-boundary',
    entries,
};
writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`허용 목록 생성: ${countPairs(entries)}쌍 / ${Object.keys(entries).length}파일 → scripts/lint/addon-import-allowlist.json`);
