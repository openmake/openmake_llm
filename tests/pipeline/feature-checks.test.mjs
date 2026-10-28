import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFeatures, requireRelated, assertExecuted } from '../../scripts/ci/feature-checks.mjs';

test('API sources require nonempty related Jest tests per changed source', () => {
  assert.deepEqual(selectFeatures(['apps/api/src/llm/client.ts']).api, ['apps/api/src/llm/client.ts']);
  assert.throws(() => requireRelated('apps/api/src/new.ts', []), /No related/);
  assert.throws(() => requireRelated('x', ['tests/e2e/all.spec.ts']), /Jest/);
});
test('web and known pipeline spec use fixed suites, unknown specs fail closed', () => {
  assert.equal(selectFeatures(['apps/web/src/app/page.tsx']).web, true);
  assert.equal(selectFeatures(['docs/superpowers/specs/2026-10-20-pipeline-flow-design.md']).pipeline, true);
  assert.throws(() => selectFeatures(['docs/specs/new-feature.md']), /Unmapped/);
});
test('documentation only does not invent changed feature coverage', () => {
  assert.deepEqual(selectFeatures(['README.md']), { api: [], web: false, pipeline: false, infra: false, bridge: false, discordBot: false, hostSetup: false, e2e: [] });
  assert.deepEqual(selectFeatures(['apps/api/src/evaluation/README.md']).api, []);
  assert.deepEqual(selectFeatures(['apps/api/src/evaluation/redteam/golden-redteam.json']).api, []);
  assert.deepEqual(selectFeatures(['packages/api-client/package.json']).api, []);
  assert.deepEqual(selectFeatures(['packages/shared-types/README.md']).api, []);
});
test('LiteLLM gateway config selects the pipeline suite; unmapped YAML elsewhere still fails closed', () => {
  assert.equal(selectFeatures(['scripts/vllm/litellm.config.yaml']).pipeline, true);
  assert.throws(() => selectFeatures(['scripts/foo/bar.yaml']), /Unmapped changed source: scripts\/foo\/bar\.yaml/);
});
test('root shell scripts select the pipeline suite', () => {
  const r = selectFeatures(['install_linux.sh', 'openmake_llm.sh']);
  assert.equal(r.pipeline, true); assert.deepEqual(r.api, []); assert.equal(r.web, false);
});
test('the root eslint config selects the pipeline suite', () => {
  const r = selectFeatures(['eslint.config.mjs']);
  assert.equal(r.pipeline, true); assert.deepEqual(r.api, []); assert.equal(r.web, false);
});
test('an unmapped root shell script still throws', () => {
  assert.throws(() => selectFeatures(['never-mapped.sh']), /Unmapped changed source: never-mapped\.sh/);
});

test('Jest success with skipped or missing assertions is not feature coverage', () => {
  const related = new Map([['source', ['/apps/api/src/a.test.ts']]]);
  assert.throws(() => assertExecuted(related, { testResults: [{ name: '/apps/api/src/a.test.ts', assertionResults: [{ status: 'pending' }] }] }), /No executed/);
  assert.doesNotThrow(() => assertExecuted(related, { testResults: [{ name: '/apps/api/src/a.test.ts', assertionResults: [{ status: 'passed' }] }] }));
});

test('pipeline mapping requires all five fixed environment shell suites', async () => {
  const { environmentTests } = await import('../../scripts/ci/feature-checks.mjs');
  assert.deepEqual(environmentTests().map(path => path.split('/').pop()), ['approve.test.sh', 'omk.test.sh', 'pipeline-distribution.test.sh', 'pipeline-errexit.test.sh', 'pipeline.test.sh']);
  assert.throws(() => environmentTests('/missing-fixture-checkout'), /Missing required/);
});

// Host setup (macOS installer · Colima/PM2 boot recovery): exact changed files only, fixed fixture runner.
const HOST_SETUP_FILES = [
  'scripts/setup/colima-boot-guard.cjs', 'scripts/setup/colima-boot-guard.test.sh', 'scripts/setup/docker-config-reconcile.cjs',
  'scripts/setup/fake-launchctl.test-lib.sh', 'scripts/setup/mac-host-repair.sh', 'scripts/setup/mac-host-repair.test.sh',
  'scripts/setup/mac-pm2-boot.sh', 'scripts/setup/mac-pm2-boot.test.sh', 'scripts/setup/mac-toolchain.test.sh',
  'scripts/setup/mac/30-toolchain.sh', 'scripts/setup/mac/80-finish.sh', 'scripts/setup/pm2-boot-guard.sh',
];
test('each changed host setup file selects the host setup suite; unknown setup sources still fail closed', () => {
  for (const file of HOST_SETUP_FILES) assert.equal(selectFeatures([file]).hostSetup, true, file);
  assert.equal(selectFeatures(['README.md']).hostSetup, false);
  for (const file of ['scripts/setup/new.sh', 'scripts/setup/mac/90-new.sh', 'scripts/setup/new-helper.cjs']) {
    assert.throws(() => selectFeatures([file]), /Unmapped changed source/, file);
  }
});

const HOST_FIXTURES = ['scripts/ci/docker-config-reconcile.test.mjs', 'scripts/setup/mac-toolchain.test.sh',
  'scripts/setup/colima-boot-guard.test.sh', 'scripts/setup/mac-host-repair.test.sh', 'scripts/setup/mac-pm2-boot.test.sh'];
// Tiny stand-in fixtures that only record that they ran (and can be told to fail).
// The child `node --test` must not inherit this runner's test context, or it reports instead of running.
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
async function fakeHostRoot(t, { failing } = {}) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'omk-host-fixtures-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = join(root, 'ran.log');
  for (const file of HOST_FIXTURES) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    const code = file === failing ? 1 : 0;
    writeFileSync(join(root, file), file.endsWith('.mjs')
      ? `import test from 'node:test'; import { appendFileSync } from 'node:fs';\ntest('ran', () => { appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(file + '\n')}); if (${code}) throw new Error('fixture failed'); });\n`
      : `printf '%s\\n' ${JSON.stringify(file)} >> ${JSON.stringify(log)}\nexit ${code}\n`);
  }
  return { root, log };
}

test('host setup runs the fixed portable fixtures on Linux and does not claim the delegated macOS suites ran', async t => {
  const { runFeatures } = await import('../../scripts/ci/feature-checks.mjs');
  const { readFileSync } = await import('node:fs');
  const { root, log } = await fakeHostRoot(t);
  const report = runFeatures(['scripts/setup/mac-host-repair.sh'], { cwd: root, platform: 'linux', stdio: 'ignore', env: childEnv });
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['scripts/ci/docker-config-reconcile.test.mjs', 'scripts/setup/mac-toolchain.test.sh']);
  assert.deepEqual(report.hostSetup, { platform: 'linux', executed: HOST_FIXTURES.slice(0, 2), delegatedToMacJob: HOST_FIXTURES.slice(2) });
});

test('host setup on macOS also runs the Colima guard, host repair and PM2 boot suites', async t => {
  const { runFeatures } = await import('../../scripts/ci/feature-checks.mjs');
  const { readFileSync } = await import('node:fs');
  const { root, log } = await fakeHostRoot(t);
  const report = runFeatures(['scripts/setup/colima-boot-guard.cjs'], { cwd: root, platform: 'darwin', stdio: 'ignore', env: childEnv });
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), HOST_FIXTURES);
  assert.deepEqual(report.hostSetup, { platform: 'darwin', executed: HOST_FIXTURES, delegatedToMacJob: [] });
});

test('host setup fails when a fixed fixture fails or is missing (even suites delegated on Linux)', async t => {
  const { runFeatures } = await import('../../scripts/ci/feature-checks.mjs');
  const { rmSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const failing = await fakeHostRoot(t, { failing: 'scripts/setup/mac-toolchain.test.sh' });
  assert.throws(() => runFeatures(['scripts/setup/mac/30-toolchain.sh'], { cwd: failing.root, platform: 'linux', stdio: 'ignore', env: childEnv }), /failed \(1\)/);
  const nodeFailing = await fakeHostRoot(t, { failing: 'scripts/ci/docker-config-reconcile.test.mjs' });
  assert.throws(() => runFeatures(['scripts/setup/mac/30-toolchain.sh'], { cwd: nodeFailing.root, platform: 'linux', stdio: 'ignore', env: childEnv }), /failed/);
  const missing = await fakeHostRoot(t);
  rmSync(join(missing.root, 'scripts/setup/mac-pm2-boot.test.sh'));
  assert.throws(() => runFeatures(['scripts/setup/pm2-boot-guard.sh'], { cwd: missing.root, platform: 'linux', stdio: 'ignore', env: childEnv }), /Missing required host setup test: scripts\/setup\/mac-pm2-boot.test.sh/);
  assert.equal(existsSync(missing.log), false, 'nothing runs before all fixed fixtures are present');
});

test('without host setup changes the report carries no host setup payload', async () => {
  const { runFeatures } = await import('../../scripts/ci/feature-checks.mjs');
  assert.equal('hostSetup' in runFeatures(['README.md'], { stdio: 'ignore', env: childEnv }), false);
});

// Root reproducer: the exact changed files of CI 39509448977 (origin/main..origin/dev at 2c43f122), which failed as unmapped.
test('the merged dev change set that failed as unmapped now selects host setup alongside its other suites', () => {
  const files = [
    ".github/workflows/ci.yml",
    "apps/api/src/addons/mcp-runtime/data/mcp-admin-monitoring-repository.ts",
    "apps/web/addons/mcp-runtime/pages/admin-mcp-monitoring-page.tsx",
    "apps/web/messages/de.json",
    "apps/web/messages/en.json",
    "apps/web/messages/ja.json",
    "apps/web/messages/ko.json",
    "apps/web/messages/zh.json",
    "package-lock.json",
    "packages/shared-types/src/index.ts",
    "packages/shared-types/src/mcp-monitoring.ts",
    "scripts/ci/docker-config-reconcile.test.mjs",
    "scripts/env/README.md",
    "scripts/env/pipeline-distribution.test.sh",
    "scripts/env/pipeline.test.sh",
    "scripts/setup/colima-boot-guard.cjs",
    "scripts/setup/colima-boot-guard.test.sh",
    "scripts/setup/docker-config-reconcile.cjs",
    "scripts/setup/fake-launchctl.test-lib.sh",
    "scripts/setup/mac-host-repair.sh",
    "scripts/setup/mac-host-repair.test.sh",
    "scripts/setup/mac-pm2-boot.sh",
    "scripts/setup/mac-pm2-boot.test.sh",
    "scripts/setup/mac-toolchain.test.sh",
    "scripts/setup/mac/30-toolchain.sh",
    "scripts/setup/mac/80-finish.sh",
    "scripts/setup/pm2-boot-guard.sh",
    "tests/web/mcp-monitoring.test.tsx"
  ];
  const selection = selectFeatures(files);
  assert.equal(selection.hostSetup, true);
  assert.equal(selection.web, true); assert.equal(selection.pipeline, true);
});

// The MCP monitoring contract (type-only exports) has no related Jest tests; its consumer is the web monitoring suite
// (tests/web/mcp-monitoring.test.tsx) and the required build gate typechecks the API producer and web consumer.
test('the two exact MCP monitoring shared-type files select the web suite, not related API Jest', () => {
  for (const file of ['packages/shared-types/src/index.ts', 'packages/shared-types/src/mcp-monitoring.ts']) {
    const selection = selectFeatures([file]);
    assert.equal(selection.web, true, file);
    assert.deepEqual(selection.api, [], file);
  }
  // Any other shared-types source keeps the generic related-Jest rule (and fails if nothing relates to it).
  assert.deepEqual(selectFeatures(['packages/shared-types/src/new-contract.ts']).api, ['packages/shared-types/src/new-contract.ts']);
  assert.equal(selectFeatures(['packages/shared-types/src/new-contract.ts']).web, false);
});

// PR CI selection: the same "related Jest tests must exist" rule as merged dev, without running anything.
test('selectRelatedTests requires related Jest tests per API source and never lists for docs', async () => {
  const { selectRelatedTests } = await import('../../scripts/ci/feature-checks.mjs');
  const source = 'apps/api/src/llm/client.ts';
  assert.throws(() => selectRelatedTests([source], { listRelated: () => [] }), /No related Jest tests for apps\/api\/src\/llm\/client\.ts/);
  const related = '/repo/apps/api/src/llm/__tests__/client.test.ts';
  const selected = selectRelatedTests([source], { listRelated: file => (assert.equal(file, source), [related]) });
  assert.deepEqual(selected.related.get(source), [related]);
  assert.equal(selected.tests.has(related), true);
  let calls = 0;
  const docs = selectRelatedTests(['README.md'], { listRelated: () => { calls += 1; return []; } });
  assert.equal(calls, 0);
  assert.deepEqual(docs.selection.api, []);
});

// A deleted test file was itself the regression test: it passes without a mapping (one log line).
// Deleted non-test API source still fails closed until a regression test is mapped.
test('selectRelatedTests lets deleted test files through and still rejects deleted API source', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { selectRelatedTests } = await import('../../scripts/ci/feature-checks.mjs');
  const root = mkdtempSync(join(tmpdir(), 'omk-deleted-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const never = () => { throw new Error('Jest is not consulted for deleted files'); };
  const opts = log => ({ cwd: root, log, listRelated: never, listImporters: never, listAll: never });
  const logs = [];
  const deletedTests = ['apps/api/src/__tests__/gone-provider.test.ts', 'apps/api/src/chat/__tests__/helper.ts'];
  const selected = selectRelatedTests(deletedTests, opts(line => logs.push(line)));
  assert.equal(selected.related.size, 0);
  assert.equal(selected.tests.size, 0);
  assert.deepEqual(logs, deletedTests.map(file => `Deleted test file, regression mapping not required: ${file}`));
  assert.throws(() => selectRelatedTests(['apps/api/src/chat/gone.ts'], opts(() => {})), /Deleted source requires explicit regression mapping: apps\/api\/src\/chat\/gone\.ts/);
});

// Type-only edges are in Jest's graph (apps/api/jest.dependency-extractor.mjs). Last resort: a type-only source with no related
// test is excused only when nothing imports it (or it is a declaration file); importers that reach no test still fail.
test('selectRelatedTests excuses only unimported type-only API sources and still requires tests for any runtime code', async t => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { selectRelatedTests, isTypeOnlySource, runFeatures } = await import('../../scripts/ci/feature-checks.mjs');
  const root = mkdtempSync(join(tmpdir(), 'omk-type-only-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'apps/api/src/chat'), { recursive: true });
  const typesOnly = 'apps/api/src/chat/types.ts';
  const mixed = 'apps/api/src/chat/mixed.ts';
  writeFileSync(join(root, typesOnly), "// params\nimport type { A } from './a';\nexport interface P { a?: A; approvalCards?: boolean }\nexport type Q = P | null;\nexport type { R } from './r';\n");
  writeFileSync(join(root, mixed), 'export interface P { a: string }\nexport const LIMIT = 3;\n');
  const logs = [];
  const asked = [];
  const selected = selectRelatedTests([typesOnly], { cwd: root, log: line => logs.push(line), listRelated: () => [], listImporters: file => { asked.push(file); return []; } });
  assert.deepEqual(asked, [typesOnly]);
  assert.deepEqual(selected.typeOnly, [typesOnly]);
  assert.equal(selected.related.size, 0);
  assert.equal(selected.tests.size, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Type-only source with no importers, .*: apps\/api\/src\/chat\/types\.ts$/);
  // Imported, but no importer reaches a test: the type change cannot be exercised — fail like any untested source.
  const importer = join(root, 'apps/api/src/chat/strategy.ts');
  assert.throws(() => selectRelatedTests([typesOnly], { cwd: root, log: () => {}, listRelated: () => [], listImporters: () => [importer] }), /No related Jest tests for apps\/api\/src\/chat\/types\.ts; its importers reach no test \(apps\/api\/src\/chat\/strategy\.ts\)/);
  assert.throws(() => selectRelatedTests([mixed], { cwd: root, log: () => {}, listRelated: () => [], listImporters: () => [] }), /No related Jest tests for apps\/api\/src\/chat\/mixed\.ts/);
  const consumer = '/repo/apps/api/src/chat/consumer.test.ts';
  const found = selectRelatedTests([typesOnly], { cwd: root, log: line => logs.push(line), listRelated: () => [consumer], listImporters: () => { throw new Error('not asked when related tests exist'); } });
  assert.deepEqual([...found.related], [[typesOnly, [consumer]]]);
  assert.deepEqual(found.typeOnly, []);
  assert.equal(logs.length, 1);
  const test = '/repo/apps/api/src/chat/mixed.test.ts';
  const both = selectRelatedTests([typesOnly, mixed], { cwd: root, log: () => {}, listRelated: file => (file === mixed ? [test] : []), listImporters: () => [] });
  assert.deepEqual([...both.related], [[mixed, [test]]]);
  for (const text of ["import './side-effect';\n", 'export enum E { A }\n', 'const enum C { A }\n', "export { x } from './x';\n", 'export interface P {}\nexport function f() {}\n', 'export namespace N { export const v = 1 }\n']) assert.equal(isTypeOnlySource('a.ts', text), false, text);
  assert.equal(isTypeOnlySource('a.js', ''), false);
  // A syntax error emits only the preamble too — never excused.
  assert.equal(isTypeOnlySource('a.ts', 'export interface P { a: string\n'), false);
  for (const text of ['export {};\n', 'declare const x: number;\ndeclare function f(): void;\n', 'declare enum E { A }\n', 'export namespace N { export type T = string; export interface I {} }\n']) assert.equal(isTypeOnlySource('a.ts', text), true, text);
  // Declaration files cannot be transpiled (TypeScript throws) and have no emit by definition.
  for (const file of ['a.d.ts', 'a.d.mts', 'a.d.cts']) assert.equal(isTypeOnlySource(file, 'export interface P {}\n'), true, file);
  const declaration = 'apps/api/src/chat/globals.d.ts';
  writeFileSync(join(root, declaration), 'declare global { interface Window { omk?: string } }\nexport {};\n');
  // Ambient declarations apply without import edges, so importers are not asked.
  const declared = [];
  assert.deepEqual(selectRelatedTests([declaration], { cwd: root, log: line => declared.push(line), listRelated: () => [], listImporters: () => { throw new Error('not asked for a declaration file'); } }).typeOnly, [declaration]);
  assert.match(declared[0], /Type-only declaration file, .*globals\.d\.ts$/);
  // Run mode (`<sha>` / `--files`): a stand-in Jest finds nothing related, so nothing runs and no "No executed related tests".
  mkdirSync(join(root, 'node_modules/jest/bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules/jest/bin/jest.js'), "if (!process.argv.includes('--listTests')) process.exit(1);\nconsole.log('[]');\n");
  const report = runFeatures([typesOnly], { cwd: root, stdio: 'ignore', env: childEnv, log: () => {} });
  assert.deepEqual(report.relatedTests, []);
  assert.deepEqual(report.typeOnly, [typesOnly]);
});

// Same exemption against a real Jest graph: the broad `--testMatch` importer discovery (not a stub) decides it.
test('selectRelatedTests with real Jest fails a type module imported by untested code and excuses an unreferenced one', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { fileURLToPath } = await import('node:url');
  const { selectRelatedTests } = await import('../../scripts/ci/feature-checks.mjs');
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'omk-feature-real-jest-')));
  try {
    // The fixture borrows the installed Jest through a link; apps/api's roots/testMatch and the real extractor.
    symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
    writeFileSync(join(root, 'package.json'), '{ "private": true }\n'); // Jest needs a project root, as in the repo
    const src = join(root, 'apps/api/src');
    mkdirSync(join(src, 'types'), { recursive: true });
    const config = { roots: ['<rootDir>/src'], testMatch: ['**/*.test.ts'], cacheDirectory: join(root, '.jest-cache'), dependencyExtractor: join(repo, 'apps/api/jest.dependency-extractor.mjs') };
    writeFileSync(join(root, 'apps/api/jest.config.js'), `module.exports = ${JSON.stringify(config)};\n`);
    writeFileSync(join(src, 'types/used.ts'), 'export interface Used { a: string }\n');
    writeFileSync(join(src, 'consumer.ts'), "import type { Used } from './types/used';\nexport const make = (): Used => ({ a: '' });\n");
    writeFileSync(join(src, 'types/orphan.ts'), 'export type Orphan = string;\n');
    writeFileSync(join(src, 'types/tested.ts'), 'export type Tested = number;\n');
    writeFileSync(join(src, 'tested.ts'), "import type { Tested } from './types/tested';\nexport const n: Tested = 1;\n");
    writeFileSync(join(src, 'tested.test.ts'), "import './tested';\n");
    const logs = [];
    const options = { cwd: root, log: line => logs.push(line) };
    assert.throws(() => selectRelatedTests(['apps/api/src/types/used.ts'], options), /No related Jest tests for apps\/api\/src\/types\/used\.ts; its importers reach no test \(apps\/api\/src\/consumer\.ts\)/);
    const orphan = selectRelatedTests(['apps/api/src/types/orphan.ts'], options);
    assert.deepEqual(orphan.typeOnly, ['apps/api/src/types/orphan.ts']);
    assert.equal(orphan.tests.size, 0);
    assert.deepEqual(logs, ['Type-only source with no importers, related Jest tests not required: apps/api/src/types/orphan.ts']);
    const tested = selectRelatedTests(['apps/api/src/types/tested.ts'], options);
    assert.deepEqual([...tested.tests], [join(src, 'tested.test.ts')]);
    assert.deepEqual(tested.typeOnly, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // Cleanup removed exactly the fixture: the link went, the installed Jest it pointed at did not.
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(join(repo, 'node_modules/jest/bin/jest.js')), true);
});

// apps/discord-bot is a separate workspace with its own node --test suite — its sources select that suite, never apps/api Jest.
test('discord-bot sources select the discord-bot workspace suite', () => {
  const selection = selectFeatures(['apps/discord-bot/src/attachments.ts', 'apps/discord-bot/src/attachments.test.ts']);
  assert.equal(selection.discordBot, true);
  assert.deepEqual(selection.api, []);
  assert.equal(selectFeatures(['README.md']).discordBot, false);
});

// Jest bootstrap files (config/setup/dependency extractor) are imported by no test but run before every suite: a change selects every suite.
test('selectRelatedTests selects every Jest suite for a Jest bootstrap file', async () => {
  const { selectFeatures, selectRelatedTests } = await import('../../scripts/ci/feature-checks.mjs');
  const setup = 'apps/api/jest.setup-after-env.ts';
  assert.deepEqual(selectFeatures([setup]).api, [setup]);
  assert.deepEqual(selectFeatures(['apps/api/jest.config.js']).api, ['apps/api/jest.config.js']);
  assert.deepEqual(selectFeatures(['apps/api/jest.dependency-extractor.mjs']).api, ['apps/api/jest.dependency-extractor.mjs']);
  const all = ['/repo/apps/api/src/a.test.ts', '/repo/apps/api/src/b/__tests__/c.test.ts'];
  let related = 0;
  const selected = selectRelatedTests([setup], { listAll: () => all, listRelated: () => { related += 1; return []; } });
  assert.equal(related, 0);
  assert.deepEqual(selected.related.get(setup), all);
  assert.equal(selected.tests.size, 2);
  assert.throws(() => selectRelatedTests([setup], { listAll: () => [] }), /No related Jest tests for apps\/api\/jest\.setup-after-env\.ts/);
});

test('--select-only refuses a SHA that is not the checkout HEAD', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = spawnSync(process.execPath, ['scripts/ci/feature-checks.mjs', '--select-only', '0'.repeat(40)], { cwd: root, env: childEnv, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Tested SHA differs from checkout HEAD/);
});
