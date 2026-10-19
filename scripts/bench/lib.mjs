/**
 * API 부하 측정의 순수 함수 — I/O 없음(scripts/bench/lib.test.mjs 가 검증한다).
 *
 * 성능 게이트(설계 D6, docs/architecture/addon-platform.md §13):
 *   시나리오별 p95 ≤ 기준선 × 1.10 (작은 값의 잡음을 위해 기준선 + 2ms 까지 허용),
 *   처리율 ≥ 기준선 × 0.95, 오류율 ≤ max(기준선, 1%), RSS 최고값 ≤ 기준선 × 1.10.
 * 부하 설정이 다르거나 측정 중 API 가 재시작되면 비교하지 않는다(invalid).
 * 어느 쪽이든 오류율 ≥ errorRateInvalidCeiling 이거나 처리율 0 인 시나리오가 있으면 깨진 측정이라 invalid —
 * 깨진 기준선(오류율 100%)이면 "오류율 ≤ max(기준선, 1%)" 가 늘 통과하기 때문이다.
 * 깨진 측정은 기준선만이 아니라 현재(current) 측정도 같은 규칙으로 invalid 다.
 * 판정 우선순위: invalid(exit 2)가 regressed(exit 1)보다 앞선다 — 비교할 수 없는 측정이면 회귀 여부를 말하지 않는다.
 *
 * startSerialPoller 만 타이머를 쓴다(네트워크·파일 I/O 는 없다 — 호출 측 tick 이 한다).
 */
export const SCHEMA_VERSION = 1;

export const THRESHOLDS = Object.freeze({
    p95MaxRatio: 1.10,
    p95AbsSlackMs: 2,
    throughputMinRatio: 0.95,
    errorRateFloor: 0.01,
    errorRateInvalidCeiling: 0.5,
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

/** 2xx 가 한 건도 없는 시나리오 이름 — 대상 API 가 깨진 측정이라 receipt 로 남기지 않는다(api-load.mjs exit 3) */
export function scenariosWithoutSuccess(scenarios) {
    return scenarios.filter((s) => s.ok === 0).map((s) => s.name);
}

/**
 * RSS 표본 요약. pid 가 바뀌거나 uptime 이 줄면 측정 중 재시작으로 본다.
 * 표본에 startedAt(요청을 보낸 시각, ms)이 있으면 그 순서로 비교한다 — 응답이 늦게 온 앞 표본이 뒤에 쌓여도
 * uptime 감소로 잘못 보지 않게. failedSamples 는 실패한 표본 요청 수(기록용, 판정에 쓰지 않는다).
 */
export function summarizeRss(inputSamples, failedSamples = 0) {
    if (inputSamples.length === 0) {
        return { samples: 0, failedSamples, beforeBytes: null, afterBytes: null, peakBytes: null, pid: null, restarted: false, source: null };
    }
    const samples = inputSamples.every((x) => isNum(x.startedAt))
        ? [...inputSamples].sort((a, b) => a.startedAt - b.startedAt)
        : inputSamples;
    let restarted = false;
    for (let i = 1; i < samples.length; i += 1) {
        const a = samples[i - 1];
        const b = samples[i];
        if ((a.pid !== null && b.pid !== null && a.pid !== b.pid) || b.uptime < a.uptime) restarted = true;
    }
    const sources = new Set(samples.map((s) => s.source));
    return {
        samples: samples.length,
        failedSamples,
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

// 같은 부하인지 가르는 열쇠 — settings 와 실행 방식(runtime: ts-node 는 컴파일러 메모리가 RSS 에 섞인다)·환경
function settingsKey(receipt) {
    const s = receipt.settings;
    return JSON.stringify({
        runtime: receipt.runtime,
        environment: receipt.environment,
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
    if (settingsKey(baseline) !== settingsKey(current)) {
        problems.push(`settings mismatch — 같은 부하가 아니다: baseline ${settingsKey(baseline)} / current ${settingsKey(current)}`);
    }
    // 대상(URL)이 다르면 같은 대상의 전후 비교가 아니다 — 포트만 다른 경우도 있어 부하 열쇠와 따로 사유를 적는다
    if (baseline.target !== current.target) {
        problems.push(`target 이 다르다: baseline ${baseline.target} / current ${current.target}`);
    }
    if (baseline.rss.restarted) problems.push('baseline 측정 중 API 가 재시작됐다(pid 변경 또는 uptime 감소)');
    if (current.rss.restarted) problems.push('current 측정 중 API 가 재시작됐다(pid 변경 또는 uptime 감소)');
    for (const [side, r] of [['baseline', baseline], ['current', current]]) {
        for (const s of r.scenarios) {
            if (s.errorRate >= t.errorRateInvalidCeiling || s.throughputRps === 0) {
                problems.push(`${side} 의 ${s.name} 가 깨진 측정이다(오류율 ${s.errorRate} ≥ ${t.errorRateInvalidCeiling} 또는 처리율 ${s.throughputRps})`);
            }
        }
    }

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

/**
 * tick 을 한 번에 하나씩 돌린다 — 이전 tick 이 끝난(성공·실패 모두) 뒤 intervalMs 를 기다려 다음을 부른다.
 * setInterval 은 느린 응답이 쌓여 측정 대상에 동시 요청을 겹쳐 보내므로 쓰지 않는다.
 * 실패 집계는 tick 이 한다(거부돼도 다음 tick 은 이어진다). stop 뒤에는 새 tick 을 부르지 않는다.
 * tick 이 동기로 throw 하거나 promise 가 아닌 값을 돌려줘도 promise 로 감싼다 — throw 는 거부로 바뀌고 다음 tick 은 이어진다.
 * first 는 첫 tick 의 promise 다 — 첫 tick 이 throw·거부하면 first 도 그 오류로 거부된다.
 */
export function startSerialPoller(tick, intervalMs) {
    let stopped = false;
    let timer = null;
    const run = () => {
        const p = new Promise((resolve) => { resolve(tick()); });
        const next = () => {
            if (!stopped) timer = setTimeout(run, intervalMs);
        };
        p.then(next, next);
        return p;
    };
    return {
        first: run(),
        stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
        },
    };
}
