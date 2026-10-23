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
import ts from 'typescript';

// TypeScript 파서로 선언만 본다 — 문자열·템플릿·주석·정규식·JSX 텍스트 안의 비슷한 글자는 선언이 아니다.
// import/export 선언은 최상위와 `declare module '…' { }` 블록 안에만 올 수 있다.
// 구문은 filePath 확장자(.ts/.tsx/…)로 정해지고, 구문 오류가 있어도 던지지 않고 파서가 복구한 선언만 센다.
function addTypeOnlyEdges(statements, dependencies) {
    for (const node of statements) {
        if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body)) addTypeOnlyEdges(node.body.statements, dependencies);
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : ts.isExportDeclaration(node) && node.isTypeOnly;
        // 지정자가 빠진 선언(`from ;`)은 파서가 빈 식별자로 채운다 — 문자열 리터럴만 센다.
        if (typeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependencies.add(node.moduleSpecifier.text);
    }
}

export function extract(code, filePath, defaultExtract) {
    const dependencies = new Set(defaultExtract(code, filePath));
    // 타입 전용 선언에는 `type` 키워드가 그대로 있어야 한다(키워드는 escape 로 쓸 수 없다) — 없으면 파싱하지 않는다.
    if (!/\btype\b/.test(code)) return dependencies;
    addTypeOnlyEdges(ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest).statements, dependencies);
    return dependencies;
}

// haste 캐시 키 — 이 파일이 바뀌면 캐시된 의존성 목록을 버리고 다시 추출한다.
export function getCacheKey() {
    return createHash('sha1').update(readFileSync(new URL(import.meta.url))).digest('hex');
}
