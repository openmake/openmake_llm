/**
 * MetricsCollector 스냅샷 → Prometheus 텍스트 포맷(0.0.4) 직렬화 (R9-a, 2026-10-22). 순수 함수.
 *
 * 키는 `buildKey` 가 만든 `name{k="v",...}` 형식이다 — `{` 앞이 이름, 안쪽은 이미 정렬·인용된 라벨이라
 * 그대로 쓴다(라벨 값의 `"`·`\`·줄바꿈 이스케이프는 `buildKey` 가 한다).
 * 히스토그램은 버킷이 없으므로 p50/p95/p99 를 summary 로, sum·count 는 `_window_sum`·`_window_count` 게이지로 낸다.
 */
import type { MetricsCollector } from './metrics';

type Snapshot = ReturnType<MetricsCollector['getAllMetrics']>;
interface SummaryStats { count: number; sum: number; p50: number; p95: number; p99: number }
interface Series { labels: string; lines: Array<[suffix: string, extraLabel: string, value: number]> }

function splitKey(key: string): { name: string; labels: string } {
    const i = key.indexOf('{');
    const rawName = i < 0 ? key : key.slice(0, i);
    return { name: rawName.replace(/[^a-zA-Z0-9_:]/g, '_'), labels: i < 0 ? '' : key.slice(i + 1, -1) };
}

function fmt(name: string, labels: string, value: number): string | null {
    if (!Number.isFinite(value)) return null;
    return `${name}${labels ? `{${labels}}` : ''} ${String(value)}`;
}

function renderType(type: 'counter' | 'gauge' | 'summary', byName: Map<string, Series[]>): string[] {
    const out: string[] = [];
    for (const name of [...byName.keys()].sort()) {
        const rows: string[] = [];
        const series = byName.get(name)!.sort((a, b) => (a.labels < b.labels ? -1 : a.labels > b.labels ? 1 : 0));
        for (const s of series) {
            for (const [suffix, extra, value] of s.lines) {
                const labels = [s.labels, extra].filter(Boolean).join(',');
                const line = fmt(name + suffix, labels, value);
                if (line !== null) rows.push(line);
            }
        }
        if (rows.length > 0) out.push(`# TYPE ${name} ${type}`, ...rows);
    }
    return out;
}

function group(entries: Record<string, unknown> | undefined, toLines: (v: unknown) => Series['lines'] | null): Map<string, Series[]> {
    const byName = new Map<string, Series[]>();
    for (const [key, v] of Object.entries(entries ?? {})) {
        const lines = toLines(v);
        if (!lines) continue;
        const { name, labels } = splitKey(key);
        const list = byName.get(name) ?? [];
        list.push({ labels, lines });
        byName.set(name, list);
    }
    return byName;
}

export function renderPromText(all: Snapshot): string {
    const scalar = (v: unknown): Series['lines'] | null => (typeof v === 'number' ? [['', '', v]] : null);
    const stats = (v: unknown): SummaryStats | null => (v && typeof v === 'object' ? v as SummaryStats : null);
    const summary = (v: unknown): Series['lines'] | null => {
        const s = stats(v);
        return s && [['', 'quantile="0.5"', s.p50], ['', 'quantile="0.95"', s.p95], ['', 'quantile="0.99"', s.p99]];
    };
    // sum·count 는 슬라이딩 윈도우 값이라 누적 카운터(summary 의 _sum·_count)가 아니다 — 게이지로 낸다
    const windowGauge = (suffix: string, pick: (s: SummaryStats) => number): Map<string, Series[]> => {
        const byName = group(all.histograms as Record<string, unknown> | undefined, (v) => { const s = stats(v); return s && [['', '', pick(s)]]; });
        return new Map([...byName].map(([name, series]) => [name + suffix, series]));
    };
    const lines = [
        ...renderType('counter', group(all.counters as Record<string, unknown> | undefined, scalar)),
        ...renderType('gauge', group(all.gauges as Record<string, unknown> | undefined, scalar)),
        ...renderType('summary', group(all.histograms as Record<string, unknown> | undefined, summary)),
        ...renderType('gauge', windowGauge('_window_sum', (s) => s.sum)),
        ...renderType('gauge', windowGauge('_window_count', (s) => s.count)),
    ];
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
