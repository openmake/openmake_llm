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
  assert.deepEqual(selectFeatures(['README.md']), { api: [], web: false, pipeline: false, infra: false, bridge: false });
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
