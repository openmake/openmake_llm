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
  assert.deepEqual(selectFeatures(['README.md']), { api: [], web: false, pipeline: false, infra: false, bridge: false, hostSetup: false, e2e: [] });
  assert.deepEqual(selectFeatures(['apps/api/src/evaluation/README.md']).api, []);
  assert.deepEqual(selectFeatures(['apps/api/src/evaluation/redteam/golden-redteam.json']).api, []);
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
