import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 고정 그룹 + cancel-in-progress: false 는 대기 실행을 하나만 남긴다 — 건너뛸 실행이 그 자리를 차지하면 안 된다.
for (const [file, group] of [['auto-merge.yml', 'pipeline-auto-merge'], ['promote.yml', 'pipeline-promote']]) {
    test(`${file}: runs that will be skipped get their own concurrency group, using the job if condition`, () => {
        const workflow = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8');
        const condition = workflow.match(/^\s{4}if: (.+)$/m)?.[1] ?? '';
        assert.ok(condition.includes("github.event.workflow_run.conclusion == 'success'"), 'job if still requires successful CI');
        assert.equal(workflow.match(/^\s{2}group: (.+)$/m)?.[1], `\${{ (${condition}) && '${group}' || format('${group}-skip-{0}', github.run_id) }}`);
        assert.match(workflow, /^\s{2}cancel-in-progress: false$/m);
    });
}
