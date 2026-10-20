import test from 'node:test';
import assert from 'node:assert/strict';
import { selectE2E, assertE2EExecuted } from '../../scripts/ci/feature-checks-e2e.mjs';
const spec = 'tests/e2e/pipeline-basic.spec.ts';
const config = { specs: { [spec]: { target: 'api' } }, sourcePrefixes: { 'apps/web/': [spec] } };
test('changed functional specs and fixed source mappings select exact declared targets', () => {
  assert.deepEqual(selectE2E([spec, 'apps/web/src/page.tsx'], config), [{ file: spec, target: 'api' }]);
  assert.throws(() => selectE2E(['tests/e2e/new-feature.spec.ts'], config), /Declare.*target/);
  assert.throws(() => selectE2E([spec], { specs: { [spec]: { target: 'remote' } } }), /target/);
  assert.throws(() => selectE2E([spec], { specs: { [spec]: { target: 'api' } } }, '/missing'), /Missing/);
  assert.throws(() => selectE2E(['apps/web/src/page.tsx'], { ...config, sourcePrefixes: { 'apps/web/': ['tests/e2e/../evil.spec.ts'] } }), /Unsafe/);
});
test('Playwright report requires actual passed test for every exact selected file', () => {
  const report = status => ({ suites: [{ specs: [{ file: 'pipeline-basic.spec.ts', tests: [{ projectName: 'chromium', results: [{ status }] }] }] }], errors: [] });
  assert.equal(assertE2EExecuted(spec, report('passed')), 1);
  for (const status of ['skipped', 'failed', 'timedOut']) assert.throws(() => assertE2EExecuted(spec, report(status)), /passed|failed/);
  assert.throws(() => assertE2EExecuted(spec, { suites: [], errors: [] }), /passed/);
  assert.throws(() => assertE2EExecuted(spec, { ...report('passed'), errors: [{ message: 'setup failed' }] }), /failed/);
});
