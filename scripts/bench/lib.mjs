/**
 * API 부하 측정의 순수 함수 — I/O 없음(scripts/bench/lib.test.mjs 가 검증한다).
 *
 * 성능 게이트(설계 D6, docs/architecture/addon-platform.md §13):
 *   시나리오별 p95 ≤ 기준선 × 1.10 (작은 값의 잡음을 위해 기준선 + 2ms 까지 허용),
 *   처리율 ≥ 기준선 × 0.95, 오류율 ≤ max(기준선, 1%), RSS 최고값 ≤ 기준선 × 1.10.
 * 부하 설정이 다르거나 측정 중 API 가 재시작되면 비교하지 않는다(invalid).
 */
export const SCHEMA_VERSION = 1;

export const THRESHOLDS = Object.freeze({
    p95MaxRatio: 1.10,
    p95AbsSlackMs: 2,
    throughputMinRatio: 0.95,
    errorRateFloor: 0.01,
    rssMaxRatio: 1.10,
});

export const SCENARIO_NAMES = Object.freeze(['health', 'v1-models', 'knowledge-spaces']);

const MIB = 1048576;
const RSS_SOURCES = ['process', 'rssMB'];

/** nearest-rank 백분위. 빈 배열이면 null. */
export function percentile(values, p) {
    if (!(p > 0 && p <= 100)) throw new RangeError(`p 는 (0, 100] 이어야 한다: ${p}`);
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function round(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}

function count2xx(statusCounts) {
    let ok = 0;
    for (const [status, n] of Object.entries(statusCounts)) {
        const code = Number(status);
        if (code >= 200 && code < 300) ok += n;
    }
    return ok;
}

/** 한 시나리오의 원시 측정(응답별 지연·상태 건수·전송 오류)을 receipt 행으로 만든다 */
export function summarizeScenario({ name, method, path, latenciesMs, statusCounts, transportErrors, durationSec }) {
    const responded = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const requests = responded + transportErrors;
    const ok = count2xx(statusCounts);
    return {
        name,
        method,
        path,
        requests,
        ok,
        errorRate: requests === 0 ? 1 : round((requests - ok) / requests, 4),
        throughputRps: durationSec > 0 ? round(ok / durationSec, 2) : 0,
        p50Ms: percentile(latenciesMs, 50),
        p95Ms: percentile(latenciesMs, 95),
        p99Ms: percentile(latenciesMs, 99),
        statusCounts: { ...statusCounts },
        transportErrors,
    };
}

/** RSS 표본 요약. pid 가 바뀌거나 uptime 이 줄면 측정 중 재시작으로 본다 */
export function summarizeRss(samples) {
    if (samples.length === 0) {
        return { samples: 0, beforeBytes: null, afterBytes: null, peakBytes: null, pid: null, restarted: false, source: null };
    }
    let restarted = false;
    for (let i = 1; i < samples.length; i += 1) {
        const a = samples[i - 1];
        const b = samples[i];
        if ((a.pid !== null && b.pid !== null && a.pid !== b.pid) || b.uptime < a.uptime) restarted = true;
    }
    const sources = new Set(samples.map((s) => s.source));
    return {
        samples: samples.length,
        beforeBytes: samples[0].rss,
        afterBytes: samples[samples.length - 1].rss,
        peakBytes: Math.max(...samples.map((s) => s.rss)),
        pid: samples[0].pid,
        restarted,
        source: sources.size === 1 ? samples[0].source : 'mixed',
    };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateReceipt(r) {
    if (!r || typeof r !== 'object') return ['receipt 가 객체가 아니다'];
    const errors = [];
    if (r.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion ${r.schemaVersion} ≠ ${SCHEMA_VERSION}`);
    if (!r.settings || typeof r.settings !== 'object') errors.push('settings 없음');
    if (!Array.isArray(r.scenarios) || r.scenarios.length === 0) errors.push('scenarios 가 비었다');
    for (const s of r.scenarios ?? []) {
        for (const k of ['p95Ms', 'throughputRps', 'errorRate']) {
            if (!isNum(s[k])) errors.push(`${s.name}.${k} 가 숫자가 아니다`);
        }
    }
    if (!r.rss || !isNum(r.rss.peakBytes)) errors.push('rss.peakBytes 가 숫자가 아니다(RSS 표본 없음)');
    else if (!RSS_SOURCES.includes(r.rss.source)) errors.push(`rss.source 가 ${RSS_SOURCES.join('|')} 가 아니다: ${r.rss.source}`);
    return errors;
}

function settingsKey(s) {
    return JSON.stringify({
        connections: s.connections,
        durationSec: s.durationSec,
        warmupSec: s.warmupSec,
        settleSec: s.settleSec,
        v1RatePerSec: s.v1RatePerSec,
        scenarios: [...(s.scenarios ?? [])].sort(),
    });
}

export function compareReceipts(baseline, current, t = THRESHOLDS) {
    const problems = [
        ...validateReceipt(baseline).map((e) => `baseline: ${e}`),
        ...validateReceipt(current).map((e) => `current: ${e}`),
    ];
    if (problems.length > 0) return { verdict: 'invalid', rows: [], problems };
    if (settingsKey(baseline.settings) !== settingsKey(current.settings)) {
        problems.push(`settings mismatch — 같은 부하가 아니다: baseline ${settingsKey(baseline.settings)} / current ${settingsKey(current.settings)}`);
    }
    if (baseline.rss.restarted) problems.push('baseline 측정 중 API 가 재시작됐다(pid 변경 또는 uptime 감소)');
    if (current.rss.restarted) problems.push('current 측정 중 API 가 재시작됐다(pid 변경 또는 uptime 감소)');

    const rows = [];
    for (const b of baseline.scenarios) {
        const c = current.scenarios.find((s) => s.name === b.name);
        if (!c) {
            problems.push(`current 에 시나리오 없음: ${b.name}`);
            continue;
        }
        const p95Limit = Math.max(b.p95Ms * t.p95MaxRatio, b.p95Ms + t.p95AbsSlackMs);
        rows.push({ scenario: b.name, metric: 'p95Ms', baseline: b.p95Ms, current: c.p95Ms, limit: `≤ ${round(p95Limit, 2)}`, pass: c.p95Ms <= p95Limit });
        const tpLimit = b.throughputRps * t.throughputMinRatio;
        rows.push({ scenario: b.name, metric: 'throughputRps', baseline: b.throughputRps, current: c.throughputRps, limit: `≥ ${round(tpLimit, 2)}`, pass: c.throughputRps >= tpLimit });
        const errLimit = Math.max(b.errorRate, t.errorRateFloor);
        rows.push({ scenario: b.name, metric: 'errorRate', baseline: b.errorRate, current: c.errorRate, limit: `≤ ${errLimit}`, pass: c.errorRate <= errLimit });
    }
    for (const c of current.scenarios) {
        if (!baseline.scenarios.some((b) => b.name === c.name)) problems.push(`baseline 에 없는 시나리오: ${c.name}(기준선 미측정)`);
    }

    // 옛 코드(관리자 process 필드 없음)의 기준선은 MiB 정수(rssMB)라, 출처가 다르면 둘 다 MiB 로 내린다
    const coarse = baseline.rss.source !== current.rss.source;
    const bRss = coarse ? Math.round(baseline.rss.peakBytes / MIB) * MIB : baseline.rss.peakBytes;
    const cRss = coarse ? Math.round(current.rss.peakBytes / MIB) * MIB : current.rss.peakBytes;
    const rssLimit = bRss * t.rssMaxRatio;
    rows.push({ scenario: 'process', metric: coarse ? 'rssPeakBytes(MiB 단위)' : 'rssPeakBytes', baseline: bRss, current: cRss, limit: `≤ ${Math.round(rssLimit)}`, pass: cRss <= rssLimit });

    const verdict = problems.length > 0 ? 'invalid' : rows.every((r) => r.pass) ? 'pass' : 'regressed';
    return { verdict, rows, problems };
}

export function renderComparison({ verdict, rows, problems }, meta) {
    const lines = [`# 부하 비교 — ${verdict}`, '', `- baseline: ${meta.baseline}`, `- current: ${meta.current}`, ''];
    if (problems.length > 0) {
        lines.push('## 무효 사유', '');
        for (const p of problems) lines.push(`- ${p}`);
        lines.push('');
    }
    lines.push('| 시나리오 | 지표 | 기준선 | 현재 | 한계 | 판정 |', '|---|---|---|---|---|---|');
    for (const r of rows) lines.push(`| ${r.scenario} | ${r.metric} | ${r.baseline} | ${r.current} | ${r.limit} | ${r.pass ? '통과' : '초과'} |`);
    return `${lines.join('\n')}\n`;
}

export function exitCodeForVerdict(verdict) {
    if (verdict === 'pass') return 0;
    if (verdict === 'regressed') return 1;
    return 2;
}
