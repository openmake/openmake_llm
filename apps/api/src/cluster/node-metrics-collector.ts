/**
 * vLLM(선택: DCGM) `/metrics` 주기 스크레이프 (F24.4, 143).
 *
 * 대상마다 마지막 스냅샷·성공 시각·오류를 메모리에 두고(관리자 카드·큐 샘플러가 읽는다) 샘플을 DB 에 적재한다.
 * 전부 fail-open — 스크레이프 실패는 그 노드를 stale 로 표시할 뿐 앱 동작에 영향이 없다.
 *
 * @module cluster/node-metrics-collector
 */
import { NODE_METRICS } from '../config/runtime-limits';
import { MODEL_POOL_CONFIG } from '../config/model-pool';
import { createLogger } from '../utils/logger';
import { getMetrics } from '../monitoring/metrics';
import { parsePromText, toNodeSnapshot, SNAPSHOT_METRIC_NAMES, type NodeGpuSnapshot } from './prom-text-parser';
import type { NodeMetricSampleRow } from '../data/repositories/node-metrics-repository';

const logger = createLogger('NodeMetrics');

export interface NodeMetricsState {
    nodeId: string;
    url: string;
    snapshot: NodeGpuSnapshot | null;
    lastOkAt: string | null;
    lastError: string | null;
    /** 마지막 성공 이후 STALE_AFTER_MS 가 지났으면 true(한 번도 성공 못 했으면 true) */
    stale: boolean;
}

const states = new Map<string, Omit<NodeMetricsState, 'stale'>>();

/** PURE: 스크레이프 대상 — env 목록 우선, 없으면 tokenize URL 의 origin + /metrics. */
export function resolveNodeMetricsUrls(urls: readonly string[] = NODE_METRICS.URLS, tokenizeUrl: string = MODEL_POOL_CONFIG.tokenizeUrl): string[] {
    if (urls.length) return [...urls];
    if (!tokenizeUrl) return [];
    try { return [`${new URL(tokenizeUrl).origin}/metrics`]; } catch { return []; }
}

/** PURE: host:port — 노드 식별자(라벨·DB node_id). */
export function nodeIdFromUrl(url: string): string {
    try { return new URL(url).host; } catch { return url; }
}

/** PURE: 스냅샷 → DB 샘플 행. */
export function snapshotToSamples(nodeId: string, snap: NodeGpuSnapshot): NodeMetricSampleRow[] {
    const rows: NodeMetricSampleRow[] = [];
    for (const [key, metric] of Object.entries(SNAPSHOT_METRIC_NAMES) as Array<[keyof typeof SNAPSHOT_METRIC_NAMES, string]>) {
        const v = snap[key];
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ nodeId, metric, value: v });
    }
    return rows;
}

async function scrapeOne(url: string, fetchImpl: typeof fetch): Promise<NodeGpuSnapshot> {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(NODE_METRICS.TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return toNodeSnapshot(parsePromText(await res.text()));
}

/** 전 대상 1회 스크레이프 — 성공분 샘플을 돌려준다(적재는 호출부). */
export async function scrapeNodeMetricsOnce(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<NodeMetricSampleRow[]> {
    const urls = resolveNodeMetricsUrls();
    const rows: NodeMetricSampleRow[] = [];
    await Promise.all(urls.map(async (url) => {
        const nodeId = nodeIdFromUrl(url);
        const prev = states.get(url);
        try {
            const snapshot = await scrapeOne(url, fetchImpl);
            states.set(url, { nodeId, url, snapshot, lastOkAt: new Date(now).toISOString(), lastError: null });
            rows.push(...snapshotToSamples(nodeId, snapshot));
            if (snapshot.kvCacheUsagePct !== undefined) getMetrics().setGauge('vllm_kv_cache_pct', snapshot.kvCacheUsagePct, { node: nodeId });
            if (snapshot.requestsWaiting !== undefined) getMetrics().setGauge('vllm_requests_waiting', snapshot.requestsWaiting, { node: nodeId });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (prev?.lastError !== msg) logger.warn(`스크레이프 실패 ${nodeId}: ${msg}`);
            states.set(url, { nodeId, url, snapshot: prev?.snapshot ?? null, lastOkAt: prev?.lastOkAt ?? null, lastError: msg });
        }
    }));
    return rows;
}

export function getNodeMetricsStates(now = Date.now()): NodeMetricsState[] {
    return [...states.values()].map((s) => ({
        ...s,
        stale: !s.lastOkAt || now - Date.parse(s.lastOkAt) > NODE_METRICS.STALE_AFTER_MS,
    }));
}

/** 신선한 스냅샷의 대기 요청 합(큐 샘플러용). 신선한 노드가 없으면 undefined. */
export function currentVllmWaiting(now = Date.now()): number | undefined {
    const fresh = getNodeMetricsStates(now).filter((s) => !s.stale && s.snapshot?.requestsWaiting !== undefined);
    return fresh.length ? fresh.reduce((n, s) => n + (s.snapshot?.requestsWaiting ?? 0), 0) : undefined;
}

export function resetNodeMetricsStates(): void {
    states.clear();
}
