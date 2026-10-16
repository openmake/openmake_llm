import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    percentile, summarizeScenario, summarizeRss, validateReceipt,
    compareReceipts, renderComparison, exitCodeForVerdict,
} from './lib.mjs';

function receipt(overrides = {}) {
    return {
        schemaVersion: 1,
        settings: { connections: 10, durationSec: 30, warmupSec: 5, v1RatePerSec: 4, scenarios: ['health', 'knowledge-spaces'] },
        scenarios: [
            { name: 'health', p95Ms: 10, throughputRps: 400, errorRate: 0 },
            { name: 'knowledge-spaces', p95Ms: 50, throughputRps: 100, errorRate: 0 },
        ],
        rss: { peakBytes: 1000, restarted: false, source: 'process' },
        ...overrides,
    };
}

function withScenario(name, patch) {
    const r = receipt();
    r.scenarios = r.scenarios.map((s) => (s.name === name ? { ...s, ...patch } : s));
    return r;
}

test('percentile: nearest-rank, 빈 배열 null, 범위 밖 p 는 RangeError', () => {
    assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
    const oneToTwenty = Array.from({ length: 20 }, (_, i) => i + 1);
    assert.equal(percentile(oneToTwenty, 95), 19);
    assert.equal(percentile(oneToTwenty, 100), 20);
    assert.equal(percentile([], 95), null);
    assert.throws(() => percentile([1], 0), RangeError);
});

test('summarizeScenario: 429·전송 오류를 오류율에 넣고 2xx 만 처리율로 센다', () => {
    const s = summarizeScenario({
        name: 'health', method: 'GET', path: '/health',
        latenciesMs: [1, 2, 3, 4], statusCounts: { 200: 3, 429: 1 }, transportErrors: 1, durationSec: 2,
    });
    assert.equal(s.requests, 5);
    assert.equal(s.ok, 3);
    assert.equal(s.errorRate, 0.4);
    assert.equal(s.throughputRps, 1.5);
    assert.equal(s.p95Ms, 4);
    assert.deepEqual(s.statusCounts, { 200: 3, 429: 1 });
});

test('summarizeRss: 최고값·처음·끝, pid 변경이나 uptime 감소는 restarted', () => {
    const same = summarizeRss([
        { rss: 10, pid: 1, uptime: 5, source: 'process' },
        { rss: 30, pid: 1, uptime: 6, source: 'process' },
        { rss: 20, pid: 1, uptime: 7, source: 'process' },
    ]);
    assert.deepEqual(same, { samples: 3, beforeBytes: 10, afterBytes: 20, peakBytes: 30, pid: 1, restarted: false, source: 'process' });
    assert.equal(summarizeRss([
        { rss: 10, pid: 1, uptime: 5, source: 'process' },
        { rss: 10, pid: 2, uptime: 6, source: 'process' },
    ]).restarted, true);
    assert.equal(summarizeRss([
        { rss: 10, pid: null, uptime: 50, source: 'rssMB' },
        { rss: 10, pid: null, uptime: 3, source: 'rssMB' },
    ]).restarted, true);
    assert.equal(summarizeRss([]).peakBytes, null);
});

test('validateReceipt: 필수 필드가 없으면 이유를 돌려준다', () => {
    assert.deepEqual(validateReceipt(receipt()), []);
    assert.ok(validateReceipt(receipt({ rss: { peakBytes: null, restarted: false, source: 'process' } })).some((e) => e.includes('rss.peakBytes')));
    assert.ok(validateReceipt(receipt({ scenarios: [] })).some((e) => e.includes('scenarios')));
    assert.ok(validateReceipt(receipt({ schemaVersion: 2 })).some((e) => e.includes('schemaVersion')));
});

test('compareReceipts: 같으면 pass, exit 0', () => {
    const r = compareReceipts(receipt(), receipt());
    assert.equal(r.verdict, 'pass');
    assert.equal(exitCodeForVerdict(r.verdict), 0);
    assert.equal(r.rows.length, 7);
});

test('compareReceipts: p95 10% 초과는 regressed, 작은 값은 +2ms 까지 허용', () => {
    assert.equal(compareReceipts(receipt(), withScenario('health', { p95Ms: 13 })).verdict, 'regressed');
    assert.equal(compareReceipts(receipt(), withScenario('health', { p95Ms: 12 })).verdict, 'pass');
    assert.equal(compareReceipts(receipt(), withScenario('knowledge-spaces', { p95Ms: 56 })).verdict, 'regressed');
});

test('compareReceipts: 처리율 95% 미만·오류율 1% 초과·RSS 10% 초과는 regressed', () => {
    assert.equal(compareReceipts(receipt(), withScenario('knowledge-spaces', { throughputRps: 94 })).verdict, 'regressed');
    assert.equal(compareReceipts(receipt(), withScenario('health', { errorRate: 0.02 })).verdict, 'regressed');
    assert.equal(compareReceipts(receipt(), withScenario('health', { errorRate: 0.005 })).verdict, 'pass');
    assert.equal(compareReceipts(receipt(), receipt({ rss: { peakBytes: 1101, restarted: false, source: 'process' } })).verdict, 'regressed');
    assert.equal(compareReceipts(receipt(), receipt({ rss: { peakBytes: 1100, restarted: false, source: 'process' } })).verdict, 'pass');
});

test('compareReceipts: settings mismatch·재시작·시나리오 누락은 invalid, exit 2', () => {
    const other = receipt({ settings: { ...receipt().settings, connections: 20 } });
    const mismatch = compareReceipts(receipt(), other);
    assert.equal(mismatch.verdict, 'invalid');
    assert.ok(mismatch.problems[0].startsWith('settings mismatch'));
    assert.equal(exitCodeForVerdict(mismatch.verdict), 2);
    assert.equal(compareReceipts(receipt(), receipt({ rss: { peakBytes: 1000, restarted: true, source: 'process' } })).verdict, 'invalid');
    const missing = receipt();
    missing.scenarios = missing.scenarios.slice(0, 1);
    assert.equal(compareReceipts(receipt(), missing).verdict, 'invalid');
});

test('compareReceipts: source 가 다르면 RSS 를 MiB 로 내려 비교한다', () => {
    const mib = 1048576;
    const base = receipt({ rss: { peakBytes: 500 * mib, restarted: false, source: 'rssMB' } });
    const cur = receipt({ rss: { peakBytes: 550 * mib + 300000, restarted: false, source: 'process' } });
    const r = compareReceipts(base, cur);
    assert.equal(r.verdict, 'pass');
    assert.equal(r.rows.at(-1).current, 550 * mib);
});

test('renderComparison: 표 한 줄에 기준선·현재·한계·판정이 있다', () => {
    const md = renderComparison(compareReceipts(receipt(), receipt()), { baseline: 'b.json', current: 'c.json' });
    assert.ok(md.startsWith('# 부하 비교 — pass'));
    assert.ok(md.includes('| health | p95Ms | 10 | 10 | ≤ 12 | 통과 |'));
});

test('compare.mjs CLI: exit 0·1·2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-compare-'));
    const write = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
    const base = write('b.json', receipt());
    const run = (cur) => spawnSync(process.execPath, [new URL('./compare.mjs', import.meta.url).pathname, '--baseline', base, '--current', cur], { encoding: 'utf8' }).status;
    assert.equal(run(write('same.json', receipt())), 0);
    assert.equal(run(write('slow.json', withScenario('health', { p95Ms: 30 }))), 1);
    assert.equal(run(write('bad.json', receipt({ settings: { connections: 1 } }))), 2);
    assert.equal(run(join(dir, 'none.json')), 2);
});
