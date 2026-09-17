/**
 * Prometheus 텍스트 포맷 화이트리스트 파서 (F24.4) — PURE, prom-client 의존 없음.
 *
 * vLLM `/metrics`(0.10+ 는 `vllm:kv_cache_usage_perc`, 구버전은 `vllm:gpu_cache_usage_perc`)와 DCGM exporter 의 필요한
 * 지표만 읽어 노드 스냅샷으로 합친다. 같은 지표가 여러 라벨 조합(엔진·모델)으로 오면 합산(카운터·게이지) 또는 최대(사용률)로 접는다.
 *
 * @module cluster/prom-text-parser
 */

export interface NodeGpuSnapshot {
    /** KV 캐시 사용률(%) — vLLM 이 0~1 로 준다 */
    kvCacheUsagePct?: number;
    requestsRunning?: number;
    requestsWaiting?: number;
    preemptionsTotal?: number;
    promptTokensTotal?: number;
    generationTokensTotal?: number;
    /** 서버 기동 이후 평균 TTFT(초) — histogram sum/count */
    ttftAvgSeconds?: number;
    models?: string[];
    /** DCGM(선택) */
    gpuUtilPct?: number;
    gpuMemUsedMiB?: number;
    gpuTempC?: number;
}

interface Sample { name: string; labels: Record<string, string>; value: number }

const LINE_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([^\s]+)(?:\s+\d+)?$/;
const LABEL_RE = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

/** 관심 지표 이름 — 이 밖은 버린다(vLLM 은 400개 이상을 낸다). */
const WANTED = new Set([
    'vllm:num_requests_running', 'vllm:num_requests_waiting', 'vllm:kv_cache_usage_perc', 'vllm:gpu_cache_usage_perc',
    'vllm:num_preemptions_total', 'vllm:prompt_tokens_total', 'vllm:generation_tokens_total',
    'vllm:time_to_first_token_seconds_sum', 'vllm:time_to_first_token_seconds_count',
    'DCGM_FI_DEV_GPU_UTIL', 'DCGM_FI_DEV_FB_USED', 'DCGM_FI_DEV_GPU_TEMP',
]);

export function parsePromText(text: string): Sample[] {
    const out: Sample[] = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const m = LINE_RE.exec(line);
        if (!m || !WANTED.has(m[1])) continue;
        const value = Number(m[4]);
        if (!Number.isFinite(value)) continue;
        const labels: Record<string, string> = {};
        for (const lm of (m[3] ?? '').matchAll(LABEL_RE)) labels[lm[1]] = lm[2];
        out.push({ name: m[1], labels, value });
    }
    return out;
}

/** PURE: 샘플 → 노드 스냅샷. 값이 없던 지표는 필드를 두지 않는다. */
export function toNodeSnapshot(samples: Sample[]): NodeGpuSnapshot {
    const sum = (name: string): number | undefined => {
        const xs = samples.filter((s) => s.name === name);
        return xs.length ? xs.reduce((n, s) => n + s.value, 0) : undefined;
    };
    const max = (name: string): number | undefined => {
        const xs = samples.filter((s) => s.name === name);
        return xs.length ? Math.max(...xs.map((s) => s.value)) : undefined;
    };
    const kv = max('vllm:kv_cache_usage_perc') ?? max('vllm:gpu_cache_usage_perc');
    const ttftSum = sum('vllm:time_to_first_token_seconds_sum');
    const ttftCount = sum('vllm:time_to_first_token_seconds_count');
    const models = [...new Set(samples.map((s) => s.labels.model_name).filter((x): x is string => !!x))];
    const snap: NodeGpuSnapshot = {
        ...(kv !== undefined ? { kvCacheUsagePct: Math.round(kv * 1000) / 10 } : {}),
        ...(sum('vllm:num_requests_running') !== undefined ? { requestsRunning: sum('vllm:num_requests_running') } : {}),
        ...(sum('vllm:num_requests_waiting') !== undefined ? { requestsWaiting: sum('vllm:num_requests_waiting') } : {}),
        ...(sum('vllm:num_preemptions_total') !== undefined ? { preemptionsTotal: sum('vllm:num_preemptions_total') } : {}),
        ...(sum('vllm:prompt_tokens_total') !== undefined ? { promptTokensTotal: sum('vllm:prompt_tokens_total') } : {}),
        ...(sum('vllm:generation_tokens_total') !== undefined ? { generationTokensTotal: sum('vllm:generation_tokens_total') } : {}),
        ...(ttftSum !== undefined && ttftCount ? { ttftAvgSeconds: Math.round((ttftSum / ttftCount) * 1000) / 1000 } : {}),
        ...(models.length ? { models } : {}),
        ...(max('DCGM_FI_DEV_GPU_UTIL') !== undefined ? { gpuUtilPct: max('DCGM_FI_DEV_GPU_UTIL') } : {}),
        ...(sum('DCGM_FI_DEV_FB_USED') !== undefined ? { gpuMemUsedMiB: sum('DCGM_FI_DEV_FB_USED') } : {}),
        ...(max('DCGM_FI_DEV_GPU_TEMP') !== undefined ? { gpuTempC: max('DCGM_FI_DEV_GPU_TEMP') } : {}),
    };
    return snap;
}

/** 스냅샷 → 샘플 행(metric 이름은 snake, 적재·추이 조회용). */
export const SNAPSHOT_METRIC_NAMES: Readonly<Record<keyof Omit<NodeGpuSnapshot, 'models'>, string>> = {
    kvCacheUsagePct: 'vllm_kv_cache_pct',
    requestsRunning: 'vllm_requests_running',
    requestsWaiting: 'vllm_requests_waiting',
    preemptionsTotal: 'vllm_preemptions_total',
    promptTokensTotal: 'vllm_prompt_tokens_total',
    generationTokensTotal: 'vllm_generation_tokens_total',
    ttftAvgSeconds: 'vllm_ttft_avg_seconds',
    gpuUtilPct: 'dcgm_gpu_util',
    gpuMemUsedMiB: 'dcgm_fb_used_mib',
    gpuTempC: 'dcgm_gpu_temp',
};
