/**
 * MetricsCollector 스냅샷 → Prometheus 텍스트 포맷(0.0.4) 직렬화 (R9-a, 2026-10-22). 순수 함수.
 *
 * 키는 `buildKey` 가 만든 `name{k="v",...}` 형식이다 — `{` 앞이 이름, 안쪽은 이미 정렬·인용된 라벨이라
 * 그대로 쓴다(라벨 값의 `"`·`\`·줄바꿈 이스케이프는 `buildKey` 가 한다).
 * 히스토그램은 버킷이 없으므로 p50/p95/p99 를 summary 로, sum·count 는 `_window_sum`·`_window_count` 게이지로 낸다.
 *
 * 이름 배정(#1477): 패밀리 = (종류, 원본 이름). 치환(`a-b`→`a_b`)·숫자 시작(`1x`→`_1x`)·종류 간·summary 파생 이름이
 * 겹치면 전체 export 를 한 번에 보고 정한다 — 원본이 이미 유효한 이름 > counter·gauge·summary > 원본 이름 순으로 먼저 자기
 * 이름을 갖고, 진 쪽은 `<이름>_<sha256(종류·원본·시도) 앞 8자>` 로 옮긴다(그 결과도 전체 이름과 대조). 입력 순서와 무관하다.
 * summary 는 자기 이름·두 윈도우 게이지·Prometheus 가 summary 몫으로 읽는 `_sum`·`_count` 를 함께 차지하고 함께 옮긴다.
 */
import { createHash } from 'crypto';
import type { MetricsCollector } from './metrics';

type Snapshot = ReturnType<MetricsCollector['getAllMetrics']>;
type Kind = 'counter' | 'gauge' | 'summary';
interface SummaryStats { count: number; sum: number; p50: number; p95: number; p99: number }
interface Series { labels: string; lines: Array<[suffix: string, extraLabel: string, value: number]> }
interface Family { kind: Kind; raw: string; base: string; series: Series[] }

const KIND_RANK: Record<Kind, number> = { counter: 0, gauge: 1, summary: 2 };
const SUMMARY_CLAIMS = ['', '_window_sum', '_window_count', '_sum', '_count'];
const SUFFIX_HEX = 8;

function splitKey(key: string): { raw: string; labels: string } {
    const i = key.indexOf('{');
    return { raw: i < 0 ? key : key.slice(0, i), labels: i < 0 ? '' : key.slice(i + 1, -1) };
}

function sanitizeName(raw: string): string {
    const name = raw.replace(/[^a-zA-Z0-9_:]/g, '_');
    return /^[a-zA-Z_:]/.test(name) ? name : `_${name}`;
}

const claimsOf = (f: Family, name: string): string[] => (f.kind === 'summary' ? SUMMARY_CLAIMS.map((s) => name + s) : [name]);
const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/** 전체 export 의 패밀리 → 출력 이름. 1차: 정규화 이름, 2차: 진 패밀리에 원본 identity suffix */
function assignNames(families: Family[]): Map<Family, string> {
    const valid = (f: Family): number => (f.base === f.raw ? 0 : 1);
    const ordered = [...families].sort((a, b) => cmp(valid(a), valid(b)) || cmp(KIND_RANK[a.kind], KIND_RANK[b.kind]) || cmp(a.raw, b.raw));
    const taken = new Set<string>();
    const names = new Map<Family, string>();
    const tryClaim = (f: Family, name: string): boolean => {
        const claims = claimsOf(f, name);
        if (claims.some((n) => taken.has(n))) return false;
        for (const n of claims) taken.add(n);
        names.set(f, name);
        return true;
    };
    for (const f of ordered) tryClaim(f, f.base);
    for (const f of ordered) {
        for (let attempt = 0; !names.has(f); attempt++) {
            const hex = createHash('sha256').update(`${f.kind}\0${f.raw}\0${attempt}`).digest('hex').slice(0, SUFFIX_HEX);
            tryClaim(f, `${f.base}_${hex}`);
        }
    }
    return names;
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

/** (종류, 원본 이름)별 패밀리 — toLines 가 null 인 값(형식이 다른 항목)은 건너뛴다 */
function collect(kind: Kind, entries: Record<string, unknown> | undefined, toLines: (v: unknown) => Series['lines'] | null): Family[] {
    const byRaw = new Map<string, Family>();
    for (const [key, v] of Object.entries(entries ?? {})) {
        const lines = toLines(v);
        if (!lines) continue;
        const { raw, labels } = splitKey(key);
        const f = byRaw.get(raw) ?? { kind, raw, base: sanitizeName(raw), series: [] };
        f.series.push({ labels, lines });
        byRaw.set(raw, f);
    }
    return [...byRaw.values()];
}

export function renderPromText(all: Snapshot): string {
    const scalar = (v: unknown): Series['lines'] | null => (typeof v === 'number' ? [['', '', v]] : null);
    const stats = (v: unknown): SummaryStats | null => (v && typeof v === 'object' ? v as SummaryStats : null);
    const summary = (v: unknown): Series['lines'] | null => {
        const s = stats(v);
        return s && [['', 'quantile="0.5"', s.p50], ['', 'quantile="0.95"', s.p95], ['', 'quantile="0.99"', s.p99]];
    };
    const counters = collect('counter', all.counters as Record<string, unknown> | undefined, scalar);
    const gauges = collect('gauge', all.gauges as Record<string, unknown> | undefined, scalar);
    const summaries = collect('summary', all.histograms as Record<string, unknown> | undefined, summary);
    const names = assignNames([...counters, ...gauges, ...summaries]);
    const byName = (families: Family[]): Map<string, Series[]> => new Map(families.map((f) => [names.get(f)!, f.series]));
    // sum·count 는 슬라이딩 윈도우 값이라 누적 카운터(summary 의 _sum·_count)가 아니다 — 게이지로 낸다. 이름은 summary 를 따른다
    const summaryName = new Map(summaries.map((f) => [f.raw, names.get(f)!]));
    const windowGauge = (suffix: string, pick: (s: SummaryStats) => number): Map<string, Series[]> => new Map(
        collect('summary', all.histograms as Record<string, unknown> | undefined, (v) => { const s = stats(v); return s && [['', '', pick(s)]]; })
            .map((f) => [summaryName.get(f.raw)! + suffix, f.series]));
    const lines = [
        ...renderType('counter', byName(counters)),
        ...renderType('gauge', byName(gauges)),
        ...renderType('summary', byName(summaries)),
        ...renderType('gauge', windowGauge('_window_sum', (s) => s.sum)),
        ...renderType('gauge', windowGauge('_window_count', (s) => s.count)),
    ];
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
