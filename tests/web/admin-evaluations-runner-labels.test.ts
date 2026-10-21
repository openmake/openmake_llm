import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_EVAL_RUNNER } from '../../apps/api/src/config/pack-verification';

// eval_runs.runner 에 기록되는 값 전부 — 평가 이력 표가 t(`runner.${r.runner}`) 로 그린다.
// routing·response·tools·redteam·matrix: apps/api/src/evaluation/run-*-evaluation.ts
const RECORDED_RUNNERS = ['routing', 'response', 'tools', 'redteam', 'matrix', PACK_EVAL_RUNNER];

test('every recorded eval runner has a label in every locale', () => {
  const dir = join(process.cwd(), 'apps/web/messages');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const labels = JSON.parse(readFileSync(join(dir, file), 'utf8')).adminEvaluations.runner;
    for (const runner of RECORDED_RUNNERS) {
      assert.equal(typeof labels[runner], 'string', `${file} adminEvaluations.runner.${runner}`);
    }
  }
});
