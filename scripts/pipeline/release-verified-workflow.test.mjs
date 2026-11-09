import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/release-verified.yml', import.meta.url), 'utf8');

test('release-verified also runs when CI completes, keeping schedule and manual triggers', () => {
    assert.match(workflow, /^\s{2}schedule:\n\s{4}- cron: '\*\/10 \* \* \* \*'$/m);
    assert.match(workflow, /^\s{2}workflow_dispatch:$/m);
    assert.match(workflow, /^\s{2}workflow_run:\n\s{4}workflows: \[CI\]\n\s{4}types: \[completed\]$/m);
});

test('CI-completion runs only for successful release-please PR runs', () => {
    const condition = workflow.match(/^\s{4}if: (.+)$/m)?.[1] ?? '';
    assert.ok(condition.includes("github.event_name != 'workflow_run'"), 'schedule and workflow_dispatch stay unconditional');
    assert.ok(condition.includes("github.event.workflow_run.event == 'pull_request'"));
    assert.ok(condition.includes("github.event.workflow_run.conclusion == 'success'"));
    assert.ok(condition.includes("startsWith(github.event.workflow_run.head_branch, 'release-please--')"));
});

test('runs that will be skipped get their own concurrency group so they cannot cancel a pending orchestration run', () => {
    const group = workflow.match(/^\s{2}group: (.+)$/m)?.[1] ?? '';
    assert.ok(group.includes("github.event_name != 'workflow_run'"));
    assert.ok(group.includes("github.event.workflow_run.event == 'pull_request'"));
    assert.ok(group.includes("github.event.workflow_run.conclusion == 'success'"));
    assert.ok(group.includes("startsWith(github.event.workflow_run.head_branch, 'release-please--')"));
    assert.ok(group.includes("&& 'pipeline-release-verified' ||"), 'orchestrating runs share one group');
    assert.ok(group.includes("format('pipeline-release-verified-skip-{0}', github.run_id)"), 'skipped runs are isolated per run');
    assert.match(workflow, /^\s{2}cancel-in-progress: false$/m);
});

test('orchestration still checks out only the default branch', () => {
    assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.doesNotMatch(workflow, /workflow_run\.head_(sha|repository)/);
});
