import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataOnly, eligiblePull, requireToken, latestCI } from './github.mjs';
test('metadata JSON permits version only and rejects additions and dependency changes', () => {
    const allow = new Set(['package.json', 'package-lock.json']);
    assert.equal(metadataOnly('{"version":"1.0.0","dependencies":{"x":"1"}}', '{"version":"2.0.0","dependencies":{"x":"1"}}', 'package.json', allow), true);
    assert.equal(metadataOnly('{"version":"1.0.0"}', '{"version":"2.0.0","scripts":{"x":"bad"}}', 'package.json', allow), false);
    assert.equal(metadataOnly('{"version":"1.0.0","dependencies":{"x":"1"}}', '{"version":"2.0.0","dependencies":{"x":"2"}}', 'package.json', allow), false);
    assert.equal(metadataOnly('{"version":"1.0.0"}', '{"version":"malicious"}', 'package.json', allow), false);
    assert.equal(metadataOnly('{"version":"1.0.0"}', '{"version":"1.0.1-.."}', 'package.json', allow), false);
    assert.equal(metadataOnly(null, '{"version":"1.0.0"}', 'package.json', allow), false);
    assert.equal(metadataOnly('{"version":"1.0.0"}', '{"version":"2.0.0"}', 'evil.json', allow), false);
});
test('fork and stale PR heads cannot merge', () => {
    const pr = { state: 'open', draft: false, head: { sha: 'a', ref: 'feature/x', repo: { full_name: 'o/r' } }, base: { ref: 'dev' } };
    assert.equal(eligiblePull(pr, 'a', 'o/r'), true);
    assert.equal(eligiblePull({ ...pr, head: { ...pr.head, ref: 'feat/pipeline-flow' } }, 'a', 'o/r'), true);
    assert.equal(eligiblePull({ ...pr, head: { ...pr.head, ref: 'release/foo' } }, 'a', 'o/r'), false);
    assert.equal(eligiblePull(pr, 'b', 'o/r'), false);
    assert.equal(eligiblePull({ ...pr, head: { ...pr.head, repo: { full_name: 'fork/r' } } }, 'a', 'o/r'), false);
});
test('latest CI attempt must succeed at exact SHA', () => {
    const runs = [{ id: 2, head_sha: 'a', conclusion: 'failure' }, { id: 1, head_sha: 'a', conclusion: 'success' }];
    assert.equal(latestCI(runs, 'a'), false);
    assert.equal(latestCI([{ id: 3, head_sha: 'b', conclusion: 'success' }], 'a'), false);
});
test('missing automation credential fails actionably', () => assert.throws(() => requireToken({}), /OMK_AUTOMATION_TOKEN/));
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metadataRange } from './github.mjs';
test('per-commit gate rejects code edits even when later reverted and trusts baseline allowlist', () => {
    const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'pipeline-metadata-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(dir, 'release-please-config.json'), JSON.stringify({ packages: { '.': { 'extra-files': [] } } }));
    writeFileSync(join(dir, 'package.json'), '{"version":"1.0.0"}');
    writeFileSync(join(dir, 'code.js'), 'safe');
    git('add', '.');
    git('commit', '-qm', 'initial');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'package.json'), '{"version":"2.0.0"}');
    git('commit', '-qam', 'version');
    try {
        process.chdir(dir);
        assert.equal(metadataRange(base, git('rev-parse', 'HEAD')), true);
        writeFileSync(join(dir, 'code.js'), 'unsafe');
        git('commit', '-qam', 'code');
        writeFileSync(join(dir, 'code.js'), 'safe');
        git('commit', '-qam', 'revert');
        assert.equal(metadataRange(base, git('rev-parse', 'HEAD')), false);
    }
    finally {
        process.chdir(cwd);
    }
});
import { orchestrate } from './github.mjs';
test('trusted orchestration never enables merge after latest CI fails or head changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pipeline-event-')), eventPath = join(dir, 'event.json');
    writeFileSync(eventPath, JSON.stringify({ workflow_run: { event: 'pull_request', conclusion: 'success', head_repository: { full_name: 'o/r' }, head_sha: 'a', pull_requests: [{ number: 1 }], id: 42 } }));
    const saved = { ...process.env };
    Object.assign(process.env, { OMK_AUTOMATION_TOKEN: 'test-token', GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_PATH: eventPath });
    try {
        for (const scenario of ['stale-ci', 'head-changed', 'behind']) {
            const calls = [];
            let reads = 0;
            const pr = { number: 1, state: 'open', draft: false, head: { sha: 'a', ref: 'feat/foo', repo: { full_name: 'o/r' } }, base: { ref: 'dev' } };
            await orchestrate('feature', args => {
                calls.push(args);
                if (args[0] !== 'api') {
                    throw new Error('Unexpected mutation');
                }
                const path = args[1];
                if (path.endsWith('/pulls/1')) {
                    reads++;
                    return JSON.stringify({ ...pr, head: { ...pr.head, sha: scenario === 'head-changed' && reads > 1 ? 'b' : 'a' }, mergeable_state: scenario === 'behind' ? 'behind' : 'clean' });
                }
                if (path.includes('/runs?')) {
                    return JSON.stringify({ workflow_runs: [{ id: 2, head_sha: 'a', conclusion: scenario === 'stale-ci' ? 'failure' : 'success' }] });
                }
                if (args.includes('--slurp')) {
                    return JSON.stringify([[{ filename: 'a.js', status: 'modified', changes: 1 }]]);
                }
                if (path.endsWith('/protection')) {
                    return JSON.stringify({ required_status_checks: { strict: true, contexts: ['CI Gate (Test → Build → Size → Lint)'] } });
                }
                if (args.includes('PUT')) {
                    return '{}';
                }
                throw new Error(`Unexpected ${args}`);
            }).catch(error => {
                if (scenario !== 'head-changed') {
                    throw error;
                }
                assert.match(error.message, /head changed/);
            });
            assert.equal(calls.some(args => args[0] === 'pr' && args[1] === 'merge'), false);
            if (scenario === 'behind') {
                assert.ok(calls.some(args => args.includes('expected_head_sha=a')));
            }
        }
    }
    finally {
        for (const key of Object.keys(process.env)) {
            if (!(key in saved)) {
                delete process.env[key];
            }
        }
        Object.assign(process.env, saved);
    }
});
test('metadata-only release branch and its ordinary main merge retain verified ancestry', () => {
    const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'pipeline-release-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(dir, 'release-please-config.json'), '{"packages":{".":{"extra-files":[]}}}');
    writeFileSync(join(dir, 'package.json'), '{"version":"1.0.0"}');
    git('add', '.');
    git('commit', '-qm', 'verified');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'release-please--branches--main');
    writeFileSync(join(dir, 'package.json'), '{"version":"1.0.1"}');
    git('commit', '-qam', 'release');
    const release = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    git('merge', '--no-ff', '-qm', 'release merge', release);
    try {
        process.chdir(dir);
        assert.equal(metadataRange(base, release), true);
        assert.equal(metadataRange(base, git('rev-parse', 'HEAD')), true);
    }
    finally {
        process.chdir(cwd);
    }
});

test('promotion merges immediately only for current dev head and both latest CI events', async () => {
    const saved = {...process.env};
    const dir = mkdtempSync(join(tmpdir(), 'pipeline-promote-'));
    const eventPath = join(dir, 'event.json');
    Object.assign(process.env, {OMK_AUTOMATION_TOKEN: 'test-token', GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_PATH: eventPath});
    try {
        for (const scenario of ['ready', 'delayed-pr-ci', 'new-dev-head', 'failed-push', 'blocked']) {
            writeFileSync(eventPath, JSON.stringify({workflow_run: {event: 'pull_request', conclusion: 'success', head_branch: 'dev', head_sha: 'a'}}));
            const calls = [];
            const pr = {number: 1, head: {sha: 'a'}, base: {ref: 'main'}, mergeable_state: scenario === 'blocked' ? 'blocked' : 'clean'};
            await orchestrate('promote', args => {
                calls.push(args);
                if (args[0] === 'pr') return '';
                const path = args[1];
                if (path.endsWith('/branches/dev')) return JSON.stringify({commit: {sha: scenario === 'new-dev-head' ? 'b' : 'a'}});
                if (path.endsWith('/branches/main')) return JSON.stringify({commit: {sha: 'base'}});
                if (path.includes('/runs?')) return JSON.stringify({workflow_runs: [{id: 2, head_sha: 'a', conclusion: path.includes('event=push') && scenario === 'failed-push' ? 'failure' : path.includes('event=pull_request') && scenario === 'delayed-pr-ci' ? null : 'success'}]});
                if (path.endsWith('/protection')) return JSON.stringify({required_status_checks: {strict: true, contexts: ['CI Gate (Test → Build → Size → Lint)']}});
                if (path.endsWith('/compare/main...dev')) return '{"ahead_by":1}';
                if (path.includes('/pulls?')) return JSON.stringify([pr]);
                if (path.endsWith('/pulls/1')) return JSON.stringify(pr);
                throw new Error(`Unexpected ${args}`);
            });
            const merges = calls.filter(args => args[0] === 'pr' && args[1] === 'merge');
            assert.equal(merges.length, scenario === 'ready' ? 1 : 0, scenario);
            if (merges.length) {
                assert.ok(!merges[0].includes('--auto'));
                assert.deepEqual(merges[0].slice(-5), ['--merge', '--match-head-commit', 'a', '--body', 'Merged head a']);
                // 머지 커밋 본문이 PR 제목(fix(..): ..)이면 release-please 가 같은 변경을 두 번 적는다.
                assert.doesNotMatch(merges[0].at(-1), /^[a-z]+(\(.+\))?!?: /);
            }
        }
    } finally {
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
    }
});

test('release polling does not retain merge approval while main gains functional changes', async () => {
    const saved = {...process.env}, cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'pipeline-release-poll-'));
    const git = (...args) => execFileSync('git', args, {cwd: dir, encoding: 'utf8'}).trim();
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'test');
    git('remote', 'add', 'origin', dir);
    writeFileSync(join(dir, 'release-please-config.json'), '{"packages":{".":{"extra-files":[]}}}');
    writeFileSync(join(dir, 'package.json'), '{"version":"1.0.0"}'); git('add', '.'); git('commit', '-qm', 'verified');
    const verified = git('rev-parse', 'HEAD'); git('update-ref', `refs/omk/verified/${verified}`, verified);
    git('checkout', '-qb', 'release-please--branches--main');
    writeFileSync(join(dir, 'package.json'), '{"version":"1.0.1"}'); git('commit', '-qam', 'release');
    const head = git('rev-parse', 'HEAD'); git('checkout', '-q', 'main');
    Object.assign(process.env, {OMK_AUTOMATION_TOKEN: 'test-token', GITHUB_REPOSITORY: 'o/r'});
    const calls = [];
    try {
        process.chdir(dir);
        for (const scenario of ['waiting-ci', 'new-functional-main']) {
            if (scenario === 'new-functional-main') {
                writeFileSync(join(dir, 'code.js'), 'functional change'); git('add', '.'); git('commit', '-qm', 'code');
            }
            const main = git('rev-parse', 'main');
            await orchestrate('release', args => {
                calls.push(args);
                if (args[0] !== 'api') throw new Error('Unexpected merge mutation');
                const path = args[1];
                if (path.endsWith('/branches/main')) return JSON.stringify({commit: {sha: main}});
                if (path.includes('/git/matching-refs/')) return JSON.stringify([{ref: `refs/omk/verified/${verified}`, object: {sha: verified}}]);
                if (path.includes('/pulls?')) return JSON.stringify([{number: 1, head: {sha: head, ref: 'release-please--branches--main', repo: {full_name: 'o/r'}}, labels: [{name: 'autorelease: pending'}], draft: false}]);
                if (path.includes('/runs?')) return JSON.stringify({workflow_runs: [{id: 1, head_sha: head, conclusion: scenario === 'waiting-ci' ? null : 'success'}]});
                throw new Error(`Unexpected ${args}`);
            });
        }
        assert.equal(calls.some(args => args[0] === 'pr'), false);
    } finally {
        process.chdir(cwd);
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
    }
});
test('release gate accepts lockfile workspace versions listed in extra-files and nothing else', () => {
    const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'pipeline-lock-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    const lock = (root, ws, dep = '1.0.0') => JSON.stringify({ name: 'r', version: root, packages: { '': { version: root }, 'apps/api': { version: ws, dependencies: { x: dep } }, 'node_modules/x': { version: dep } } });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(dir, 'release-please-config.json'), JSON.stringify({ packages: { '.': { 'extra-files': [{ type: 'json', path: 'package-lock.json', jsonpath: "$.packages['apps/api'].version" }] } } }));
    writeFileSync(join(dir, 'package-lock.json'), lock('1.0.0', '0.9.0'));
    git('add', '.');
    git('commit', '-qm', 'initial');
    const base = git('rev-parse', 'HEAD');
    try {
        process.chdir(dir);
        writeFileSync(join(dir, 'package-lock.json'), lock('1.0.1', '1.0.1'));
        git('commit', '-qam', 'release');
        assert.equal(metadataRange(base, git('rev-parse', 'HEAD')), true);
        git('reset', '-q', '--hard', base);
        writeFileSync(join(dir, 'package-lock.json'), lock('1.0.1', 'malicious'));
        git('commit', '-qam', 'bad version');
        assert.equal(metadataRange(base, git('rev-parse', 'HEAD')), false);
        git('reset', '-q', '--hard', base);
        writeFileSync(join(dir, 'package-lock.json'), lock('1.0.1', '1.0.1', '2.0.0'));
        git('commit', '-qam', 'dependency change');
        assert.equal(metadataRange(base, git('rev-parse', 'HEAD')), false);
    }
    finally {
        process.chdir(cwd);
    }
});
