#!/usr/bin/env node
/**
 * API 부하 측정 — 같은 부하로 /health · /api/v1/models · /api/knowledge/spaces 를 치고
 * 응답별 지연의 p50/p95/p99·처리율·오류율과 API 프로세스 RSS 를 receipt(JSON)로 저장한다.
 *
 *   BENCH_ADMIN_EMAIL=… BENCH_ADMIN_PASSWORD=… node scripts/bench/api-load.mjs \
 *     --base-url http://localhost:52428 --label baseline --target-sha <sha> --out <파일> \
 *     [--run-id <id>] [--connections 10] [--duration 30] [--warmup 5] [--settle 90] [--v1-rate 4] \
 *     [--scenarios health,v1-models,knowledge-spaces] [--environment 로컬] [--runtime ts-node]
 *
 * - 대상 API 는 일반 리미터를 풀어(RL_GENERAL_IP·RL_GENERAL_USER) 띄운다 — 그래도 생긴 429 는 오류로 센다.
 * - v1 은 키별 RPM 300 이 있어 --v1-rate(초당, 기본 4)의 고정 속도로 친다(처리율은 그 속도를 지켰는지 본다).
 * - RSS 는 1초마다 /api/health 를 관리자 쿠키로 읽는다: process.rss(바이트)가 있으면 그것,
 *   없으면(이 필드가 없는 옛 코드) services.memory.rssMB × 1048576. uptime 감소·pid 변경은 재시작으로 기록한다
 *   (표본을 보낸 시각 순으로 비교 — 응답 순서 역전은 재시작이 아니다). 실패한 표본 수는 rss.failedSamples 로 남긴다.
 * - --settle(초, 기본 90): 로그인 뒤 이만큼 기다린 다음 첫 RSS 표본·워밍업·측정을 시작한다 — 부팅 직후
 *   일시 피크(내장 팩 설치 등)를 재지 않게. 값은 settings.settleSec 로 남고, 기준선과 다르면 비교가 무효다.
 * exit: 0 저장 · 2 인자·env 오류(`--settle ""`·음수 포함) · 3 대상 API 오류(연결·로그인·키 발급·RSS 표본 없음)
 */
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import autocannon from 'autocannon';
import { SCENARIO_NAMES, SCHEMA_VERSION, summarizeRss, summarizeScenario } from './lib.mjs';

const RSS_SAMPLE_INTERVAL_MS = 1000;
const MIB = 1048576;
const ENVIRONMENTS = ['로컬', '개발', '스테이징', '운영'];
// 대상 API 를 띄울 때 셸로 주는 설정 이름 후보(값은 기록하지 않는다). 측정 셸에 실제로 있는 것만 receipt 에 남긴다 —
// 대상 API 와 같은 셸 환경에서 이 스크립트를 돌린다는 전제다.
const TARGET_ENV_CANDIDATES = [
    'NODE_ENV', 'PORT', 'DATABASE_URL', 'RL_GENERAL_IP', 'RL_GENERAL_USER',
    'KNOWLEDGE_WORKER_MODE', 'KNOWLEDGE_STORAGE_DIR', 'LLM_BASE_URL', 'LLM_MODEL_PROBE_INTERVAL_MS',
    'CAPABILITY_JOB_POLLER_ENABLED', 'AGENT_TASK_QUEUE_ENABLED', 'AGENT_TASK_SCHEDULES_ENABLED',
    'AGENT_TASK_LEASE_ENABLED', 'AGENT_TASK_BOOT_RECOVERY', 'AGENT_SELF_IMPROVE_FIRST_RUN_DELAY_MS',
    'NODE_METRICS_ENABLED', 'GATE_REPORT_ENABLED', 'OTEL_ENABLED',
    'OPERATOR_WEBHOOK_URL', 'OPERATOR_WEBHOOK_URL_CRITICAL', 'OPERATOR_WEBHOOK_URL_WARNING', 'OPERATOR_WEBHOOK_URL_INFO',
    'TS_NODE_TRANSPILE_ONLY',
];

function presentEnvNames() {
    return TARGET_ENV_CANDIDATES.filter((name) => process.env[name] !== undefined);
}

function usageError(message) {
    console.error(`[bench] ${message}`);
    process.exit(2);
}

function parseCli(argv) {
    // 인자 오류는 exit 2 — '-1' 처럼 '-' 로 시작하는 값은 parseArgs 가 던지므로 여기서 잡는다(main 의 catch 는 exit 3)
    let values;
    try {
        ({ values } = parseArgs({
            args: argv,
            strict: true,
            options: {
                'base-url': { type: 'string' },
                label: { type: 'string' },
                'target-sha': { type: 'string' },
                out: { type: 'string' },
                'run-id': { type: 'string', default: '' },
                connections: { type: 'string', default: '10' },
                duration: { type: 'string', default: '30' },
                warmup: { type: 'string', default: '5' },
                settle: { type: 'string', default: '90' },
                'v1-rate': { type: 'string', default: '4' },
                scenarios: { type: 'string', default: SCENARIO_NAMES.join(',') },
                environment: { type: 'string', default: '로컬' },
                runtime: { type: 'string', default: 'ts-node' },
            },
        }));
    } catch (e) {
        usageError(`인자 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
    const missing = ['base-url', 'label', 'target-sha', 'out'].filter((k) => !values[k]);
    if (missing.length > 0) usageError(`필수 인자 없음: ${missing.map((k) => `--${k}`).join(', ')}`);
    const scenarios = values.scenarios.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = scenarios.filter((s) => !SCENARIO_NAMES.includes(s));
    if (unknown.length > 0) usageError(`모르는 시나리오: ${unknown.join(', ')} (가능: ${SCENARIO_NAMES.join(', ')})`);
    if (!ENVIRONMENTS.includes(values.environment)) usageError(`--environment 는 ${ENVIRONMENTS.join('|')} 중 하나`);
    if (!['ts-node', 'node-dist'].includes(values.runtime)) usageError('--runtime 은 ts-node|node-dist');
    const positiveInt = (k) => {
        const n = Number.parseInt(values[k], 10);
        if (!(n > 0)) usageError(`--${k} 는 양의 정수: ${values[k]}`);
        return n;
    };
    const nonNegativeInt = (k) => {
        // Number('') 는 0 이라 빈 값을 따로 거절한다
        const n = values[k].trim() === '' ? Number.NaN : Number(values[k]);
        if (!Number.isInteger(n) || n < 0) usageError(`--${k} 는 0 이상의 정수: ${values[k]}`);
        return n;
    };
    return {
        baseUrl: values['base-url'].replace(/\/$/, ''),
        label: values.label,
        targetSha: values['target-sha'],
        out: values.out,
        runId: values['run-id'],
        connections: positiveInt('connections'),
        durationSec: positiveInt('duration'),
        warmupSec: positiveInt('warmup'),
        settleSec: nonNegativeInt('settle'),
        v1RatePerSec: positiveInt('v1-rate'),
        scenarios,
        environment: values.environment,
        runtime: values.runtime,
    };
}

async function login(baseUrl, email, password) {
    const t = await fetch(`${baseUrl}/api/csrf-token`);
    if (!t.ok) throw new Error(`csrf-token ${t.status}`);
    const csrf = (await t.json())?.token;
    if (typeof csrf !== 'string' || !csrf) throw new Error('csrf-token 응답에 token 없음');
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `csrf_token=${csrf}` },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`로그인 실패 ${res.status}`);
    const auth = res.headers.getSetCookie().map((c) => /^auth_token=([^;]+)/.exec(c)).find(Boolean);
    if (!auth) throw new Error('로그인 응답에 auth_token 쿠키 없음');
    return { cookie: `auth_token=${auth[1]}; csrf_token=${csrf}`, csrf };
}

async function createApiKey(baseUrl, session, name) {
    const res = await fetch(`${baseUrl}/api/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
        body: JSON.stringify({ name, scopes: ['chat'] }),
    });
    if (res.status !== 201) throw new Error(`API 키 발급 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json())?.data;
    if (typeof data?.key !== 'string' || data?.api_key?.id === undefined) throw new Error('API 키 응답 형식이 다르다(data.key·data.api_key.id)');
    return { plain: data.key, id: String(data.api_key.id) };
}

async function deleteApiKey(baseUrl, session, id) {
    const res = await fetch(`${baseUrl}/api/api-keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
    });
    if (!res.ok) console.error(`[bench] API 키 ${id} 삭제 실패 ${res.status} — 이 id 로 직접 지운다`);
}

async function readProcessSample(baseUrl, session) {
    const res = await fetch(`${baseUrl}/api/health`, { headers: { Cookie: session.cookie } });
    if (!res.ok) throw new Error(`/api/health ${res.status}`);
    const body = await res.json();
    if (typeof body?.process?.rss === 'number') {
        return { rss: body.process.rss, pid: body.process.pid, uptime: body.uptime, source: 'process' };
    }
    const rssMB = body?.services?.memory?.rssMB;
    if (typeof rssMB !== 'number') throw new Error('/api/health 에 process.rss 도 services.memory.rssMB 도 없다');
    return { rss: rssMB * MIB, pid: null, uptime: body.uptime, source: 'rssMB' };
}

function startRssSampler(baseUrl, session) {
    const samples = [];
    let lastError = null;
    let failed = 0;
    // startedAt: 요청을 보낸 시각 — 응답 순서가 뒤바뀌어도 summarizeRss 가 보낸 순서로 재시작을 판단한다
    const tick = () => {
        const startedAt = Date.now();
        return readProcessSample(baseUrl, session).then(
            (s) => { samples.push({ ...s, startedAt }); },
            (e) => { failed += 1; lastError = e; },
        );
    };
    const timer = setInterval(tick, RSS_SAMPLE_INTERVAL_MS);
    return {
        first: tick(),
        stop() {
            clearInterval(timer);
            return { samples, failed, lastError };
        },
    };
}

function runAutocannon({ url, headers, connections, durationSec, overallRate }) {
    return new Promise((resolve, reject) => {
        const latenciesMs = [];
        const statusCounts = {};
        const instance = autocannon(
            { url, headers, connections, duration: durationSec, ...(overallRate ? { overallRate } : {}) },
            (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ latenciesMs, statusCounts, transportErrors: result.errors, durationSec: result.duration });
            },
        );
        instance.on('response', (_client, statusCode, _resBytes, responseTime) => {
            latenciesMs.push(responseTime);
            statusCounts[statusCode] = (statusCounts[statusCode] ?? 0) + 1;
        });
    });
}

function scenarioRequest(name, ctx) {
    if (name === 'health') return { method: 'GET', path: '/health', headers: {}, overallRate: undefined };
    if (name === 'v1-models') {
        return { method: 'GET', path: '/api/v1/models', headers: { Authorization: `Bearer ${ctx.apiKey.plain}` }, overallRate: ctx.v1RatePerSec };
    }
    return { method: 'GET', path: '/api/knowledge/spaces', headers: { Cookie: ctx.session.cookie }, overallRate: undefined };
}

async function main() {
    const opts = parseCli(process.argv.slice(2));
    const email = process.env.BENCH_ADMIN_EMAIL;
    const password = process.env.BENCH_ADMIN_PASSWORD;
    if (!email || !password) usageError('BENCH_ADMIN_EMAIL·BENCH_ADMIN_PASSWORD(관리자 계정)가 필요하다');

    const session = await login(opts.baseUrl, email, password);
    const apiKey = opts.scenarios.includes('v1-models')
        ? await createApiKey(opts.baseUrl, session, `bench-${opts.runId || Date.now()}`)
        : null;
    if (opts.settleSec > 0) {
        console.log(`[bench] settle ${opts.settleSec}초 대기 — 부팅 직후 피크가 가라앉은 뒤 잰다`);
        await new Promise((resolve) => { setTimeout(resolve, opts.settleSec * 1000); });
    }
    const sampler = startRssSampler(opts.baseUrl, session);
    await sampler.first;

    const results = [];
    let stopped;
    try {
        for (const name of opts.scenarios) {
            const req = scenarioRequest(name, { session, apiKey, v1RatePerSec: opts.v1RatePerSec });
            const url = `${opts.baseUrl}${req.path}`;
            const common = { url, headers: req.headers, connections: opts.connections, overallRate: req.overallRate };
            await runAutocannon({ ...common, durationSec: opts.warmupSec });
            const raw = await runAutocannon({ ...common, durationSec: opts.durationSec });
            const summary = summarizeScenario({ name, method: req.method, path: req.path, ...raw });
            console.log(`[bench] ${name}: p95 ${summary.p95Ms}ms · ${summary.throughputRps} rps · 오류율 ${summary.errorRate} · 상태 ${JSON.stringify(summary.statusCounts)}`);
            results.push(summary);
        }
    } finally {
        stopped = sampler.stop();
        if (apiKey) await deleteApiKey(opts.baseUrl, session, apiKey.id);
    }
    if (stopped.samples.length === 0) throw new Error(`RSS 표본 0건: ${stopped.lastError?.message ?? '원인 미상'}`);

    const receipt = {
        schemaVersion: SCHEMA_VERSION,
        runId: opts.runId,
        label: opts.label,
        gitSha: opts.targetSha,
        createdAt: new Date().toISOString(),
        environment: opts.environment,
        target: opts.baseUrl,
        runtime: opts.runtime,
        settings: {
            connections: opts.connections,
            durationSec: opts.durationSec,
            warmupSec: opts.warmupSec,
            settleSec: opts.settleSec,
            v1RatePerSec: opts.v1RatePerSec,
            scenarios: opts.scenarios,
        },
        envNames: presentEnvNames(),
        scenarios: results,
        rss: summarizeRss(stopped.samples, stopped.failed),
    };
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`[bench] 저장: ${opts.out} (RSS 최고 ${Math.round(receipt.rss.peakBytes / MIB)}MiB, 출처 ${receipt.rss.source}, 재시작 ${receipt.rss.restarted}, 실패 표본 ${receipt.rss.failedSamples})`);
}

main().catch((e) => {
    console.error(`[bench] 대상 API 오류: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(3);
});
