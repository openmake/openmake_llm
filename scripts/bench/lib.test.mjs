import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    percentile, summarizeScenario, summarizeRss, validateReceipt,
    compareReceipts, renderComparison, exitCodeForVerdict, scenariosWithoutSuccess, startSerialPoller, THRESHOLDS,
} from './lib.mjs';

function receipt(overrides = {}) {
    return {
        schemaVersion: 1,
        settings: { connections: 10, durationSec: 30, warmupSec: 5, settleSec: 90, v1RatePerSec: 4, scenarios: ['health', 'knowledge-spaces'] },
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
    assert.deepEqual(same, { samples: 3, failedSamples: 0, beforeBytes: 10, afterBytes: 20, peakBytes: 30, pid: 1, restarted: false, source: 'process' });
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
    // 부팅 직후 피크를 잰 쪽과 안정된 쪽을 비교하지 않는다 — settle 이 다르면 invalid
    const settle = compareReceipts(receipt(), receipt({ settings: { ...receipt().settings, settleSec: 0 } }));
    assert.equal(settle.verdict, 'invalid');
    assert.ok(settle.problems[0].startsWith('settings mismatch'));
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

test('summarizeRss: 늦게 온 앞 표본(응답 순서 역전)은 재시작이 아니다, failedSamples 를 남긴다', () => {
    const r = summarizeRss([
        { rss: 10, pid: 1, uptime: 5, source: 'process', startedAt: 1000 },
        { rss: 12, pid: 1, uptime: 7, source: 'process', startedAt: 3000 },
        { rss: 11, pid: 1, uptime: 6, source: 'process', startedAt: 2000 },
    ], 2);
    assert.equal(r.restarted, false);
    assert.equal(r.afterBytes, 12);
    assert.equal(r.failedSamples, 2);
    // 보낸 순서로도 uptime 이 줄면 재시작
    assert.equal(summarizeRss([
        { rss: 10, pid: null, uptime: 50, source: 'rssMB', startedAt: 1000 },
        { rss: 10, pid: null, uptime: 3, source: 'rssMB', startedAt: 2000 },
    ]).restarted, true);
});

test('compareReceipts: runtime·environment 가 다르면 settings mismatch, target 이 다르면 사유 한 줄(모두 invalid)', () => {
    const base = receipt({ runtime: 'ts-node', environment: '스테이징', target: 'http://127.0.0.1:1' });
    const rt = compareReceipts(base, receipt({ runtime: 'node-dist', environment: '스테이징', target: 'http://127.0.0.1:1' }));
    assert.equal(rt.verdict, 'invalid');
    assert.ok(rt.problems.some((p) => p.startsWith('settings mismatch') && p.includes('"runtime":"ts-node"')));
    const env = compareReceipts(base, receipt({ runtime: 'ts-node', environment: '운영', target: 'http://127.0.0.1:1' }));
    assert.equal(env.verdict, 'invalid');
    assert.ok(env.problems.some((p) => p.startsWith('settings mismatch') && p.includes('"environment":"운영"')));
    const tgt = compareReceipts(base, receipt({ runtime: 'ts-node', environment: '스테이징', target: 'http://127.0.0.1:2' }));
    assert.equal(tgt.verdict, 'invalid');
    assert.equal(tgt.problems.some((p) => p.startsWith('settings mismatch')), false);
    assert.ok(tgt.problems.includes('target 이 다르다: baseline http://127.0.0.1:1 / current http://127.0.0.1:2'));
    assert.equal(compareReceipts(base, receipt({ runtime: 'ts-node', environment: '스테이징', target: 'http://127.0.0.1:1' })).verdict, 'pass');
});

test('api-load.mjs CLI: --settle 빈 값·음수는 인자 오류 exit 2(대상 API 오류 3 이 아니다)', () => {
    const script = new URL('./api-load.mjs', import.meta.url).pathname;
    const common = ['--base-url', 'http://127.0.0.1:9', '--label', 'x', '--target-sha', 'x', '--out', join(tmpdir(), 'never.json')];
    const env = { ...process.env, BENCH_ADMIN_EMAIL: 'a@b', BENCH_ADMIN_PASSWORD: 'x' };
    for (const settle of [['--settle', ''], ['--settle', '-1'], ['--settle=-1']]) {
        const r = spawnSync(process.execPath, [script, ...common, ...settle], { encoding: 'utf8', env, timeout: 20_000 });
        assert.equal(r.status, 2, `${settle.join(' ')} → ${r.status}: ${r.stderr}`);
    }
});

test('scenariosWithoutSuccess: 2xx 가 0건인 시나리오 이름 — api-load 는 이 receipt 를 남기지 않는다(exit 3)', () => {
    const ok = { name: 'health', ok: 10 };
    const broken = { name: 'knowledge-spaces', ok: 0 };
    assert.deepEqual(scenariosWithoutSuccess([ok, broken]), ['knowledge-spaces']);
    assert.deepEqual(scenariosWithoutSuccess([ok]), []);
});

test('compareReceipts: 어느 쪽이든 오류율이 상한 이상이거나 처리율 0 인 시나리오가 있으면 invalid(깨진 기준선으로 통과하지 않는다)', () => {
    const ceiling = THRESHOLDS.errorRateInvalidCeiling;
    assert.equal(ceiling, 0.5);
    const brokenBase = withScenario('knowledge-spaces', { errorRate: 1, throughputRps: 0 });
    const r1 = compareReceipts(brokenBase, brokenBase);
    assert.equal(r1.verdict, 'invalid');
    assert.ok(r1.problems.some((p) => p.includes('baseline') && p.includes('knowledge-spaces')));
    assert.equal(compareReceipts(receipt(), withScenario('health', { errorRate: ceiling })).verdict, 'invalid');
    assert.equal(compareReceipts(withScenario('health', { throughputRps: 0 }), receipt()).verdict, 'invalid');
    // 상한 바로 아래는 기존 규칙(악화)으로 판정한다
    assert.equal(compareReceipts(receipt(), withScenario('health', { errorRate: 0.49 })).verdict, 'regressed');
});

test('compare.mjs CLI: 깨진 기준선(2xx 0건)과 비교하면 exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-compare-broken-'));
    const write = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
    const broken = withScenario('knowledge-spaces', { errorRate: 1, throughputRps: 0 });
    const r = spawnSync(process.execPath, [new URL('./compare.mjs', import.meta.url).pathname, '--baseline', write('b.json', broken), '--current', write('c.json', broken)], { encoding: 'utf8' });
    assert.equal(r.status, 2);
});

test('startSerialPoller: 느린 표본이 끝나야 다음을 보낸다 — 동시에 둘 이상 날아가지 않고, stop 뒤엔 더 보내지 않는다', async () => {
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    // 표본 하나가 간격(20ms)의 다섯 배 넘게 걸리는 느린 대상
    const tick = async () => {
        calls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(120);
        inFlight -= 1;
    };
    const poller = startSerialPoller(tick, 20);
    await poller.first;
    await sleep(400);
    poller.stop();
    const callsAtStop = calls;
    await sleep(200);
    assert.equal(maxInFlight, 1);
    assert.ok(callsAtStop >= 3, `표본 ${callsAtStop}건`);
    assert.ok(calls <= callsAtStop, 'stop 뒤에 새 표본을 보냈다');
});

test('startSerialPoller: tick 이 동기로 throw 해도 예외가 새지 않고 다음 tick 이 이어진다 — first 는 그 오류로 거부된다', async () => {
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    let calls = 0;
    // 처음 두 번은 동기 throw(첫 호출과 타이머에서 부른 호출 모두), 그 뒤로는 성공
    const tick = () => {
        calls += 1;
        if (calls <= 2) throw new Error(`동기 실패 ${calls}`);
        return Promise.resolve();
    };
    const poller = startSerialPoller(tick, 10);
    await assert.rejects(poller.first, /동기 실패 1/);
    await sleep(150);
    poller.stop();
    const callsAtStop = calls;
    await sleep(60);
    assert.ok(callsAtStop >= 4, `표본 ${callsAtStop}건`);
    assert.ok(calls <= callsAtStop, 'stop 뒤에 새 표본을 보냈다');
});
