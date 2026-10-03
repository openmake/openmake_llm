/**
 * fan-out 자원 벤치 CLI — 가짜 모델 서버로 서브에이전트 N개를 돌려 메모리·핸들·소켓 증가를 잰다.
 *
 * 병렬 위임(AGENT_SPAWN_ENABLED)은 "벤치 후 활성화"로 꺼져 있다. 이 벤치는 그 플래그를 켜지 않고
 * runSpawnAgents 를 직접 부른다 — 실제 모델·DB·도구를 쓰지 않는다(LLM 비용 0).
 *   - 모델: 이 프로세스 안에 띄운 OpenAI 호환 가짜 서버(127.0.0.1 임시 포트). 서브마다 운영과 같이 SDK 클라이언트를
 *     새로 파생해 실제 HTTP 요청을 보낸다. 각본: 도구 호출 턴 → 마지막 턴에 최종 답.
 *   - 도구: 고정 길이 텍스트를 돌려주는 가짜 도구 런타임.
 *   - DB: 닿지 않는 주소로 고정한다(도구 결과 계측이 로컬 DB 에 쓰지 않게). 작업 행이 없는 경로라 활동 기록·결과 기록도 없다.
 *
 * 재는 것은 이 프로세스(오케스트레이션) 쪽 비용이다 — GPU 처리량 분할·모델 지연은 실제 모델 벤치에서 따로 본다.
 *
 * 사용법 (apps/api 에서):
 *   node --expose-gc -r ts-node/register src/evaluation/run-fanout-resource-bench.ts
 *   node --expose-gc -r ts-node/register src/evaluation/run-fanout-resource-bench.ts --n 4,16,64 --parallel 2,8 --latency-ms 50
 * `--expose-gc` 가 없으면 GC 를 강제하지 못해 "끝난 뒤" 수치가 부풀 수 있다(표에 표시).
 *
 * env(인자가 우선): OMK_BENCH_FANOUT_N(기본 4,16,64) · OMK_BENCH_FANOUT_PARALLEL(기본 2,8)
 *      · OMK_BENCH_FANOUT_LATENCY_MS(가짜 모델 응답 지연, 기본 50) · OMK_BENCH_FANOUT_RESULT_CHARS(최종 답 길이, 기본 4000)
 *      · OMK_BENCH_FANOUT_TOOL_CHARS(도구 결과 길이, 기본 8000)
 *      · OMK_BENCH_FANOUT_SETTLE_MS(실행 뒤 "끝난 뒤" 수치를 재기 전 대기, 기본 300)
 *
 * @module evaluation/run-fanout-resource-bench
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type { AddressInfo } from 'net';

// .env 를 읽지 않는다(다른 평가 CLI 와 같은 이유). DB 는 닿지 않는 주소로 덮어쓴다 — 환경에 실제 주소가 있어도 쓰지 않는다.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'omk-bench-fanout-offline-placeholder-secret-000';
process.env.DATABASE_URL = 'postgresql://bench:bench@127.0.0.1:9/fanout_bench_no_db';
process.env.LOG_LEVEL ??= 'error';

const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
};
const list = (v: string): number[] => v.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);

const N_LIST = list(arg('n') ?? process.env.OMK_BENCH_FANOUT_N ?? '4,16,64');
const PARALLEL_LIST = list(arg('parallel') ?? process.env.OMK_BENCH_FANOUT_PARALLEL ?? '2,8');
const LATENCY_MS = parseInt(arg('latency-ms') ?? process.env.OMK_BENCH_FANOUT_LATENCY_MS ?? '50', 10);
const RESULT_CHARS = parseInt(arg('result-chars') ?? process.env.OMK_BENCH_FANOUT_RESULT_CHARS ?? '4000', 10);
const TOOL_CHARS = parseInt(arg('tool-chars') ?? process.env.OMK_BENCH_FANOUT_TOOL_CHARS ?? '8000', 10);
/** 측정 중 표본 간격 — 최고치를 놓치지 않을 만큼 짧게. */
const SAMPLE_INTERVAL_MS = 10;
/** 실행 뒤 "끝난 뒤" 수치를 재기 전에 기다리는 시간 — 짧으면 SDK 의 keep-alive 소켓이 아직 남아 있다. */
const SETTLE_MS = parseInt(arg('settle-ms') ?? process.env.OMK_BENCH_FANOUT_SETTLE_MS ?? '300', 10);
const BENCH_TOOL = 'bench_lookup';
const LOGS_DIR = path.join(__dirname, '../../logs');

// 한 호출의 태스크 상한을 벤치 최대치로 연다 — 설정 모듈을 읽기 전에 넣어야 한다.
process.env.AGENT_SPAWN_MAX_TASKS = String(Math.max(...N_LIST));

import OpenAI from 'openai';
import { AGENT_SPAWN, AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { registerToolRuntime, type ToolRuntime } from '../runtime-ports/tool-runtime';
import { runSpawnAgents } from '../services/agent-spawn/spawn-agents';
import type { ChatMessage, ToolDefinition } from '../llm/types';
import type { LLMClient } from '../llm';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;

/** 가짜 모델 서버 — 도구가 실려 온 요청에는 도구 호출을, 도구 없는 요청(서브의 마지막 턴)에는 최종 답을 돌려준다. */
function startFakeModelServer(): Promise<{ server: http.Server; baseUrl: string; stats: { calls: number; open: number; peakOpen: number } }> {
    const stats = { calls: 0, open: 0, peakOpen: 0 };
    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            stats.calls++;
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tools?: unknown[] };
            const wantsTool = Array.isArray(body.tools) && body.tools.length > 0;
            const message = wantsTool
                ? { role: 'assistant', content: '', tool_calls: [{ id: `call_${stats.calls}`, type: 'function', function: { name: BENCH_TOOL, arguments: '{"q":"bench"}' } }] }
                : { role: 'assistant', content: 'r'.repeat(RESULT_CHARS) };
            setTimeout(() => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    id: `bench-${stats.calls}`, object: 'chat.completion', model: 'bench-fake',
                    choices: [{ index: 0, message, finish_reason: wantsTool ? 'tool_calls' : 'stop' }],
                    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
                }));
            }, LATENCY_MS);
        });
    });
    server.on('connection', (socket) => {
        stats.open++;
        stats.peakOpen = Math.max(stats.peakOpen, stats.open);
        socket.on('close', () => { stats.open--; });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
        resolve({ server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, stats });
    }));
}

/** 벤치용 모델 클라이언트 — 운영 LLMClient 처럼 파생할 때마다 SDK 클라이언트를 새로 만든다(쿼터·원장·DB 는 타지 않는다). */
function benchClient(baseUrl: string): LLMClient {
    const openai = new OpenAI({ baseURL: baseUrl, apiKey: 'sk-bench', maxRetries: 0 });
    const client = {
        requestTimeout: AGENT_TASK_LIMITS.SCHEDULE_TOTAL_TIMEOUT_MS,
        derive: () => benchClient(baseUrl),
        async chat(messages: ChatMessage[], _options: unknown, _onToken: unknown, adv?: { tools?: ToolDefinition[]; signal?: AbortSignal }) {
            const r = await openai.chat.completions.create({
                model: 'bench-fake',
                messages: messages as never,
                ...(adv?.tools ? { tools: adv.tools as never } : {}),
            }, { ...(adv?.signal ? { signal: adv.signal } : {}) });
            const m = r.choices[0].message;
            const toolCalls = (m.tool_calls ?? []).flatMap((tc) => (tc.type === 'function'
                ? [{ id: tc.id, type: 'function' as const, function: { name: tc.function.name, arguments: JSON.parse(tc.function.arguments) as Record<string, unknown> } }]
                : []));
            return {
                role: 'assistant' as const, content: m.content ?? '',
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                metrics: { prompt_tokens: r.usage?.prompt_tokens ?? 0, completion_tokens: r.usage?.completion_tokens ?? 0 },
            };
        },
    };
    return client as unknown as LLMClient;
}

/** 가짜 도구 런타임 — bench_lookup 하나만 알고 고정 길이 텍스트를 돌려준다. */
const benchRuntime: ToolRuntime = {
    async listLLMTools() { return []; },
    async executeTool() { return { content: [{ type: 'text', text: 't'.repeat(TOOL_CHARS) }] }; },
    async listTools() { return []; },
    async callUserServerTool() { return null; },
    normalizeToolCall(name, args) { return { name, args }; },
    getUserToolGroups() { return []; },
    async runWithUserInputContext(_ctx, fn) { return fn(); },
    async onUserLogin() { /* no-op */ },
    async onUserLogout() { /* no-op */ },
    async onChatStart() { /* no-op */ },
    async onChatEnd() { /* no-op */ },
    async ensureUserToolsForTask() { /* no-op */ },
    async onServerReady() { /* no-op */ },
    async shutdown() { /* no-op */ },
};

const BENCH_TOOLS: ToolDefinition[] = [{
    type: 'function',
    function: { name: BENCH_TOOL, description: 'bench', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
} as ToolDefinition];

interface Snapshot { rssMb: number; heapMb: number; handles: number }
interface BenchRow {
    n: number; parallel: number; wallMs: number; modelCalls: number; peakSockets: number;
    before: Snapshot; peak: Snapshot; after: Snapshot; peakHandleTypes: Record<string, number>;
}

function snapshot(): Snapshot {
    const m = process.memoryUsage();
    return { rssMb: mb(m.rss), heapMb: mb(m.heapUsed), handles: process.getActiveResourcesInfo().length };
}

async function settled(): Promise<Snapshot> {
    await sleep(SETTLE_MS);
    global.gc?.();
    return snapshot();
}

async function runOnce(baseUrl: string, stats: { calls: number; peakOpen: number; open: number }, n: number, parallel: number): Promise<BenchRow> {
    (AGENT_SPAWN as { MAX_PARALLEL: number }).MAX_PARALLEL = parallel;
    const before = await settled();
    const callsBefore = stats.calls;
    stats.peakOpen = stats.open;
    const peak: Snapshot = { ...before };
    let peakHandleTypes: Record<string, number> = {};
    const sampler = setInterval(() => {
        const s = snapshot();
        peak.rssMb = Math.max(peak.rssMb, s.rssMb);
        peak.heapMb = Math.max(peak.heapMb, s.heapMb);
        if (s.handles > peak.handles) {
            peak.handles = s.handles;
            peakHandleTypes = {};
            for (const t of process.getActiveResourcesInfo()) peakHandleTypes[t] = (peakHandleTypes[t] ?? 0) + 1;
        }
    }, SAMPLE_INTERVAL_MS);
    const started = Date.now();
    const out = await runSpawnAgents({
        args: { tasks: Array.from({ length: n }, (_, i) => ({ prompt: `벤치 태스크 ${i + 1}: 가짜 모델로 자원 사용량을 재는 서브에이전트 실행` })) },
        client: benchClient(baseUrl),
        tools: BENCH_TOOLS,
        userCtx: { userId: 'bench', role: 'user' },
        taskId: '__chat__', // 작업 행이 없는 경로 — 활동 기록·결과 기록(DB)을 타지 않는다
        sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 0 },
    });
    const wallMs = Date.now() - started;
    clearInterval(sampler);
    if (out.startsWith('Error:') || out.includes('Error: 서브에이전트')) throw new Error(`벤치 실행 실패(n=${n}, parallel=${parallel}): ${out.slice(0, 300)}`);
    const after = await settled();
    return { n, parallel, wallMs, modelCalls: stats.calls - callsBefore, peakSockets: stats.peakOpen, before, peak, after, peakHandleTypes };
}

function render(rows: BenchRow[]): string {
    const d = (a: number, b: number): string => `${b - a >= 0 ? '+' : ''}${Math.round((b - a) * 10) / 10}`;
    const head = '   N  병렬  소요ms  모델호출  최고소켓 | RSS MB 전→최고(끝난 뒤 증감) | 힙 MB 전→최고(끝난 뒤 증감) | 핸들 전→최고→끝난 뒤';
    const lines = rows.map((r) => [
        String(r.n).padStart(4), String(r.parallel).padStart(4), String(r.wallMs).padStart(7), String(r.modelCalls).padStart(8),
        String(r.peakSockets).padStart(8), '|',
        `${r.before.rssMb}→${r.peak.rssMb} (${d(r.before.rssMb, r.after.rssMb)})`.padEnd(29), '|',
        `${r.before.heapMb}→${r.peak.heapMb} (${d(r.before.heapMb, r.after.heapMb)})`.padEnd(27), '|',
        `${r.before.handles}→${r.peak.handles}→${r.after.handles}`,
    ].join(' '));
    return [head, ...lines].join('\n');
}

async function main(): Promise<void> {
    registerToolRuntime(benchRuntime);
    const { server, baseUrl, stats } = await startFakeModelServer();
    // 예열 — 모듈 지연 로딩과 첫 연결 비용을 측정에서 뺀다.
    await runOnce(baseUrl, stats, 1, 1);
    const rows: BenchRow[] = [];
    for (const parallel of PARALLEL_LIST) {
        for (const n of N_LIST) rows.push(await runOnce(baseUrl, stats, n, parallel));
    }
    server.close();
    console.log(`fan-out 자원 벤치 — 가짜 모델 지연 ${LATENCY_MS}ms, 서브 턴 상한 ${AGENT_TASK_LIMITS.SUBAGENT_MAX_TURNS}, `
        + `도구 결과 ${TOOL_CHARS}자, 최종 답 ${RESULT_CHARS}자, 끝난 뒤 대기 ${SETTLE_MS}ms, GC 강제 ${global.gc ? '예' : '아니오(--expose-gc 없음)'}`);
    console.log(render(rows));
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const out = path.join(LOGS_DIR, `fanout-resource-bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(out, JSON.stringify({
        config: { latencyMs: LATENCY_MS, settleMs: SETTLE_MS, resultChars: RESULT_CHARS, toolChars: TOOL_CHARS, maxTurns: AGENT_TASK_LIMITS.SUBAGENT_MAX_TURNS, gcForced: !!global.gc, node: process.version },
        rows,
    }, null, 2));
    console.log(`\n결과 → ${path.relative(process.cwd(), out)}`);
}

main().then(() => process.exit(0)).catch((e) => {
    console.error('[fanout-resource-bench] 실패:', e);
    process.exit(1);
});
