#!/usr/bin/env node
/**
 * TS 7(네이티브 컴파일러) 실행 래퍼 — build/watch 의 `tsc` 는 이 스크립트를 거친다.
 *
 * `typescript` 는 TS 6(JS API — typescript-eslint·ts-jest·ts-node·Next 타입 검사가 require 하고, IDE 언어 서버가
 * lib `.d.ts`·tsserver 를 읽는다)이고, TS 7 은 `typescript7` 별칭으로 설치돼 있다. 두 패키지가 모두 `tsc` bin 을
 * 가져 `node_modules/.bin/tsc` 가 어느 쪽에 링크될지 보장되지 않는다 — 그래서 경로로 직접 실행한다.
 * (`@typescript/typescript6` 별칭은 lib·tsserver 가 없는 재수출 껍데기라 IDE 가 기본 타입을 못 찾아 쓰지 않는다.)
 * TS 6 컴파일러가 필요하면 `node node_modules/typescript/bin/tsc`.
 *
 * 사용: node scripts/tsc7.cjs [tsc 인자...]
 * @module scripts/tsc7
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const pkgDir = path.dirname(require.resolve('typescript7/package.json'));
const result = spawnSync(process.execPath, [path.join(pkgDir, 'bin', 'tsc'), ...process.argv.slice(2)], {
    stdio: 'inherit',
});
process.exit(result.status ?? 1);
