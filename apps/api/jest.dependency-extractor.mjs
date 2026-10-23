// Jest 의존성 추출기 — 기본 추출기에 "타입 전용" 모듈 간선만 더한다.
//
// jest-haste-map 의 기본 추출기는 `import type … from` / `export type … from` 을 일부러 의존성으로
// 세지 않는다. 그래서 타입만 내보내고 `import type` 으로만 쓰이는 모듈은 Jest 그래프에 간선이 없어
// `--findRelatedTests` 가 그 타입을 쓰는 코드의 테스트를 찾지 못한다(CI "related Jest tests must exist" 실패).
// 타입 모듈이 바뀌면 그 타입을 쓰는 코드의 테스트가 골라져 돌아야 하므로, 여기서 그 간선을 되살린다.
// `import { type A } from` 과 타입 위치의 `import('…')` 는 기본 추출기가 이미 센다.
// 런타임 require 에는 영향이 없다 — 이 목록은 관련 테스트 선정·haste 그래프에만 쓰인다.
// ESM(.mjs) — Jest 가 import() 로 불러온다(require 를 쓰지 않아 저장소 ESLint 규칙과도 맞는다).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// 주석 안의 import 문은 세지 않는다(기본 추출기와 같은 방식).
const BLOCK_COMMENT_RE = /\/\*[^]*?\*\//g;
const LINE_COMMENT_RE = /\/\/.*/g;
// import type X / { … } / * as N from '…' 와 export type { … } / * / * as N from '…'.
// `[^'";]` 로 한 문장 안에서만 찾는다 — `export type Mode = 'a'` 같은 선언은 from 이 없어 걸리지 않는다.
const TYPE_ONLY_EDGE_RE = /\b(?:import|export)\s+type\b\s*(?:[^'";]*?\bfrom\s*)(['"`])([^'"`]+)\1/g;

export function extract(code, filePath, defaultExtract) {
    const dependencies = new Set(defaultExtract(code, filePath));
    const stripped = code.replace(BLOCK_COMMENT_RE, '').replace(LINE_COMMENT_RE, '');
    for (const match of stripped.matchAll(TYPE_ONLY_EDGE_RE)) dependencies.add(match[2]);
    return dependencies;
}

// haste 캐시 키 — 이 파일이 바뀌면 캐시된 의존성 목록을 버리고 다시 추출한다.
export function getCacheKey() {
    return createHash('sha1').update(readFileSync(new URL(import.meta.url))).digest('hex');
}
