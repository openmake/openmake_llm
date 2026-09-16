import { parsePromText, toNodeSnapshot } from '../prom-text-parser';
import { resolveNodeMetricsUrls, nodeIdFromUrl, snapshotToSamples, resetNodeMetricsStates } from '../node-metrics-collector';

// 2026-09-17 DGX vLLM(:8002) /metrics 실측 발췌
const VLLM_TEXT = `# HELP vllm:num_requests_running Number of requests in model execution batches.
# TYPE vllm:num_requests_running gauge
vllm:num_requests_running{engine="0",model_name="qwen3.8-27b"} 2.0
vllm:num_requests_waiting{engine="0",model_name="qwen3.8-27b"} 3.0
vllm:num_requests_waiting_by_reason{engine="0",model_name="qwen3.8-27b",reason="capacity"} 3.0
vllm:kv_cache_usage_perc{engine="0",model_name="qwen3.8-27b"} 0.4567
vllm:num_preemptions_total{engine="0",model_name="qwen3.8-27b"} 1.0
vllm:prompt_tokens_total{engine="0",model_name="qwen3.8-27b"} 5.052943e+06
vllm:generation_tokens_total{engine="0",model_name="qwen3.8-27b"} 120000.0
vllm:time_to_first_token_seconds_bucket{engine="0",le="0.5",model_name="qwen3.8-27b"} 3.0
vllm:time_to_first_token_seconds_count{engine="0",model_name="qwen3.8-27b"} 4.0
vllm:time_to_first_token_seconds_sum{engine="0",model_name="qwen3.8-27b"} 6.0
python_gc_objects_collected_total{generation="0"} 1234.0
`;

describe('prom-text-parser', () => {
    it('화이트리스트 지표만 읽고 by_reason·bucket·기타 지표는 버린다', () => {
        const names = parsePromText(VLLM_TEXT).map((s) => s.name);
        expect(names).not.toContain('vllm:num_requests_waiting_by_reason');
        expect(names).not.toContain('vllm:time_to_first_token_seconds_bucket');
        expect(names).not.toContain('python_gc_objects_collected_total');
        expect(names).toContain('vllm:kv_cache_usage_perc');
    });

    it('스냅샷 — KV 비율은 %, TTFT 는 sum/count, 모델명 수집', () => {
        const snap = toNodeSnapshot(parsePromText(VLLM_TEXT));
        expect(snap).toMatchObject({
            kvCacheUsagePct: 45.7, requestsRunning: 2, requestsWaiting: 3, preemptionsTotal: 1,
            promptTokensTotal: 5052943, generationTokensTotal: 120000, ttftAvgSeconds: 1.5, models: ['qwen3.8-27b'],
        });
        expect(snap.gpuUtilPct).toBeUndefined();
    });

    it('구버전 gpu_cache_usage_perc 폴백 · 여러 엔진은 대기 합산·KV 최대', () => {
        const text = 'vllm:gpu_cache_usage_perc{engine="0"} 0.2\nvllm:gpu_cache_usage_perc{engine="1"} 0.6\n'
            + 'vllm:num_requests_waiting{engine="0"} 1\nvllm:num_requests_waiting{engine="1"} 4\n';
        expect(toNodeSnapshot(parsePromText(text))).toMatchObject({ kvCacheUsagePct: 60, requestsWaiting: 5 });
    });

    it('DCGM 지표 · 비정상 값(NaN)·깨진 줄은 무시', () => {
        const text = 'DCGM_FI_DEV_GPU_UTIL{gpu="0"} 87\nDCGM_FI_DEV_FB_USED{gpu="0"} 40000\nDCGM_FI_DEV_GPU_TEMP{gpu="0"} NaN\ngarbage line here\n';
        const snap = toNodeSnapshot(parsePromText(text));
        expect(snap).toMatchObject({ gpuUtilPct: 87, gpuMemUsedMiB: 40000 });
        expect(snap.gpuTempC).toBeUndefined();
    });

    it('count 0 이면 TTFT 평균을 두지 않는다', () => {
        const snap = toNodeSnapshot(parsePromText('vllm:time_to_first_token_seconds_sum 0\nvllm:time_to_first_token_seconds_count 0\n'));
        expect(snap.ttftAvgSeconds).toBeUndefined();
    });
});

describe('node-metrics-collector', () => {
    beforeEach(() => resetNodeMetricsStates());

    it('대상 URL — env 목록 우선, 없으면 tokenize origin + /metrics, 둘 다 없으면 빈 목록', () => {
        expect(resolveNodeMetricsUrls(['http://a:1/metrics'], 'http://b:2/tokenize')).toEqual(['http://a:1/metrics']);
        expect(resolveNodeMetricsUrls([], 'http://100.1.2.3:8002/tokenize')).toEqual(['http://100.1.2.3:8002/metrics']);
        expect(resolveNodeMetricsUrls([], '')).toEqual([]);
        expect(resolveNodeMetricsUrls([], 'not a url')).toEqual([]);
        expect(nodeIdFromUrl('http://100.1.2.3:8002/metrics')).toBe('100.1.2.3:8002');
    });

    it('스냅샷 → 샘플 행(값 있는 지표만)', () => {
        const rows = snapshotToSamples('n1', { kvCacheUsagePct: 10, requestsWaiting: 0, models: ['m'] });
        expect(rows).toEqual([
            { nodeId: 'n1', metric: 'vllm_kv_cache_pct', value: 10 },
            { nodeId: 'n1', metric: 'vllm_requests_waiting', value: 0 },
        ]);
    });
});

describe('scrapeNodeMetricsOnce (env 대상)', () => {
    const OLD = process.env.VLLM_METRICS_URLS;
    let mod: typeof import('../node-metrics-collector');
    beforeAll(() => {
        process.env.VLLM_METRICS_URLS = 'http://n1:8002/metrics,http://n2:8002/metrics';
        jest.isolateModules(() => { mod = jest.requireActual('../node-metrics-collector'); });
    });
    afterAll(() => { if (OLD === undefined) delete process.env.VLLM_METRICS_URLS; else process.env.VLLM_METRICS_URLS = OLD; });

    it('성공 노드는 샘플·상태 갱신, 실패 노드는 이전 스냅샷 유지 + 오류 + stale', async () => {
        const fetchOk = (async (url: string) => {
            if (String(url).includes('n2')) throw new Error('connect ECONNREFUSED');
            return { ok: true, status: 200, text: async () => VLLM_TEXT } as Response;
        }) as unknown as typeof fetch;
        const t0 = Date.parse('2026-09-17T00:00:00Z');
        const rows = await mod.scrapeNodeMetricsOnce(fetchOk, t0);
        expect(rows.every((r) => r.nodeId === 'n1:8002')).toBe(true);
        expect(rows.find((r) => r.metric === 'vllm_requests_waiting')?.value).toBe(3);

        const states = mod.getNodeMetricsStates(t0 + 1000);
        const n1 = states.find((s) => s.nodeId === 'n1:8002');
        const n2 = states.find((s) => s.nodeId === 'n2:8002');
        expect(n1).toMatchObject({ stale: false, lastError: null });
        expect(n2).toMatchObject({ stale: true, snapshot: null, lastError: 'connect ECONNREFUSED' });
        expect(mod.currentVllmWaiting(t0 + 1000)).toBe(3);

        // 이후 n1 이 HTTP 500 — 스냅샷은 남고, 3분 지나면 stale → 대기 합에서 빠진다
        const fetch500 = (async () => ({ ok: false, status: 500, text: async () => '' } as Response)) as unknown as typeof fetch;
        await mod.scrapeNodeMetricsOnce(fetch500, t0 + 60_000);
        const later = mod.getNodeMetricsStates(t0 + 4 * 60_000).find((s) => s.nodeId === 'n1:8002');
        expect(later).toMatchObject({ stale: true, lastError: 'HTTP 500' });
        expect(later?.snapshot?.requestsWaiting).toBe(3);
        expect(mod.currentVllmWaiting(t0 + 4 * 60_000)).toBeUndefined();
    });
});
