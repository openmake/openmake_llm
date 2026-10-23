import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const extractorPath = join(root, 'apps/api/jest.dependency-extractor.mjs');
const { extract, getCacheKey } = await import(extractorPath);
const fakeDefault = () => new Set(['./runtime']);

// Jest's default extractor drops `import type`/`export type … from`: the custom one adds exactly those edges.
test('extract adds type-only import/export specifiers to the default set', () => {
  const code = [
    "import type Default from './a';",
    'import type { B1, B2 } from "./b";',
    "import type * as C from './c';",
    'import type {\n  D1,\n  D2,\n} from \'../d\';',
    "export type { E } from './e';",
    "export type * from './f';",
    "export type * as G from './g';",
    "import type{H}from'./h';",
  ].join('\n');
  assert.deepEqual([...extract(code, '/x.ts', fakeDefault)].sort(), ['../d', './a', './b', './c', './e', './f', './g', './h', './runtime']);
});

test('extract adds nothing for code without type-only module edges', () => {
  const code = [
    "export type Mode = 'a' | 'b';",
    'export type Shape = { from: string; type: "x" };',
    "export interface P { kind: 'type' }",
    "// import type { Z } from './commented';",
    "/* export type * from './block'; */",
  ].join('\n');
  assert.deepEqual([...extract(code, '/x.ts', fakeDefault)], ['./runtime']);
});

// Import-like text that is not a declaration (strings, templates, comments, regex) adds no edge.
test('extract ignores type-only import text inside strings, templates, comments and regex literals', () => {
  const none = () => new Set();
  assert.deepEqual([...extract(`const text = "import type { X } from './not-an-import'";`, '/fixture.ts', none)], []);
  const code = [
    "const single = 'export type { S } from \"./single\"';",
    'const tpl = `import type { T } from "./template"`;',
    'const sub = `${1} import type * as U from \'./template-sub\' ${2}`;',
    "const re = /import type { R } from '.\\/regex'/;",
    "/** @example import type { J } from './jsdoc'; */",
    "const after = 1; // export type * from './line-comment'",
  ].join('\n');
  assert.deepEqual([...extract(code, '/fixture.ts', none)], []);
});

// A string before a declaration must not hide it (the old comment stripper read `//` inside the URL as a comment).
test('extract keeps a type-only declaration that follows a string containing //', () => {
  assert.deepEqual([...extract(`const url = "https://example.com"; import type { T } from './actual-types';`, '/fixture.ts', () => new Set())], ['./actual-types']);
  const code = "const a = '/* not a comment';\nimport type { B } from './after-block-opener';\nconst c = '*/';\n";
  assert.deepEqual([...extract(code, '/fixture.ts', () => new Set())], ['./after-block-opener']);
});

// filePath decides the syntax: JSX text in a .tsx file is not an import declaration.
test('extract parses .tsx files as TSX', () => {
  const code = "import type { Props } from './props';\nexport const V = (p: Props) => <p>import type X from './jsx-text'</p>;\n";
  assert.deepEqual([...extract(code, '/view.tsx', () => new Set())], ['./props']);
});

// Syntax errors never throw out of the haste worker; only declarations the parser recovers count.
test('extract tolerates malformed sources', () => {
  const code = "import type { A } from './before-error';\nconst = ;\nimport type { Q } from ;\nconst open = `import type { Z } from './unterminated'\n";
  assert.deepEqual([...extract(code, '/broken.ts', fakeDefault)].sort(), ['./before-error', './runtime']);
});

test('getCacheKey follows the extractor source so a changed extractor invalidates the haste cache', () => {
  assert.equal(getCacheKey(), createHash('sha1').update(readFileSync(extractorPath)).digest('hex'));
});

// Real Jest graph: a type module consumed through each form must select its consumer's test.
test('jest --findRelatedTests selects consumers of type-only modules with the extractor', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'omk-jest-deps-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const forms = {
    'types-import.ts': "import type { T } from './types-import';\nexport const a: T | null = null;\n",
    'types-reexport.ts': "export type { T } from './types-reexport';\nexport const b = 1;\n",
    'types-star.ts': "export type * from './types-star';\nexport const c = 1;\n",
    'types-inline.ts': "import { type T } from './types-inline';\nexport const d: T | null = null;\n",
    'types-query.ts': "export const e: import('./types-query').T | null = null;\n",
  };
  for (const [types, consumer] of Object.entries(forms)) {
    writeFileSync(join(dir, types), 'export type T = string;\n');
    writeFileSync(join(dir, `consumer-${types}`), consumer);
    writeFileSync(join(dir, `consumer-${basename(types, '.ts')}.test.ts`), `import './consumer-${basename(types, '.ts')}';\n`);
  }
  const related = (file, withExtractor) => {
    const config = { rootDir: dir, testMatch: ['**/*.test.ts'], cacheDirectory: join(dir, `.cache-${withExtractor}`), ...(withExtractor ? { dependencyExtractor: extractorPath } : {}) };
    const result = spawnSync(process.execPath, [join(root, 'node_modules/jest/bin/jest.js'), '--config', JSON.stringify(config), '--findRelatedTests', join(dir, file), '--listTests', '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).map(path => basename(path));
  };
  // Without it: the forms Jest's default regex skips find nothing (the CI gate failure); inline `type` and import() already work.
  assert.deepEqual(related('types-import.ts', false), []);
  assert.deepEqual(related('types-reexport.ts', false), []);
  assert.deepEqual(related('types-star.ts', false), []);
  assert.deepEqual(related('types-inline.ts', false), ['consumer-types-inline.test.ts']);
  assert.deepEqual(related('types-query.ts', false), ['consumer-types-query.test.ts']);
  for (const types of Object.keys(forms)) assert.deepEqual(related(types, true), [`consumer-${basename(types, '.ts')}.test.ts`], types);
  // A .tsx consumer's declaration is an edge; import-like text in a string is not.
  writeFileSync(join(dir, 'types-tsx.ts'), 'export type T = string;\n');
  writeFileSync(join(dir, 'consumer-types-tsx.tsx'), "import type { T } from './types-tsx';\nexport const f = (t: T) => <b>{t}</b>;\n");
  writeFileSync(join(dir, 'consumer-types-tsx.test.ts'), "import './consumer-types-tsx';\n");
  writeFileSync(join(dir, 'types-string.ts'), 'export type T = string;\n');
  writeFileSync(join(dir, 'consumer-types-string.ts'), "export const s = \"import type { T } from './types-string'\";\n");
  writeFileSync(join(dir, 'consumer-types-string.test.ts'), "import './consumer-types-string';\n");
  assert.deepEqual(related('types-tsx.ts', true), ['consumer-types-tsx.test.ts']);
  assert.deepEqual(related('types-string.ts', true), []);
});

test('apps/api jest.config.js wires the extractor', () => {
  const config = createRequire(import.meta.url)(join(root, 'apps/api/jest.config.js'));
  assert.equal(config.dependencyExtractor, '<rootDir>/jest.dependency-extractor.mjs');
});
