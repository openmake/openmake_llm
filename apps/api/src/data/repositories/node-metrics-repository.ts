/**
 * @module data/repositories/node-metrics-repository
 * @description `node_metrics_samples`(143) — vLLM/DCGM 스크레이프 값과 큐 깊이 샘플 적재·추이 조회·보존 정리. 호출부는 fail-open.
 */
import { BaseRepository, type QueryParam } from './base-repository';
import { NODE_METRICS } from '../../config/runtime-limits';

/** PURE: 추이 조회 기간(시간, 기본·상한 적용)과 기간별 집계 버킷(분). */
export function resolveSeriesWindow(raw: unknown): { hours: number; bucketMinutes: number } {
    const n = Number(raw);
    const hours = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), NODE_METRICS.SERIES_MAX_HOURS) : NODE_METRICS.SERIES_DEFAULT_HOURS;
    const bucketMinutes = NODE_METRICS.SERIES_BUCKETS.find(([maxH]) => hours <= maxH)?.[1] ?? NODE_METRICS.SERIES_BUCKETS[NODE_METRICS.SERIES_BUCKETS.length - 1][1];
    return { hours, bucketMinutes };
}

export interface NodeMetricSampleRow {
    nodeId: string;
    metric: string;
    value: number;
    labels?: Record<string, string>;
}

export interface NodeMetricSeriesPoint {
    bucket: string;
    node_id: string;
    labels: Record<string, string> | null;
    avg: number;
    max: number;
}

export class NodeMetricsRepository extends BaseRepository {
    async insertSamples(rows: NodeMetricSampleRow[]): Promise<void> {
        if (!rows.length) return;
        const values: QueryParam[] = [];
        const tuples = rows.map((r, i) => {
            values.push(r.nodeId, r.metric, r.labels ? JSON.stringify(r.labels) : null, r.value);
            const b = i * 4;
            return `($${b + 1}, $${b + 2}, $${b + 3}::jsonb, $${b + 4})`;
        });
        await this.query(`INSERT INTO node_metrics_samples (node_id, metric, labels, value) VALUES ${tuples.join(', ')}`, values);
    }

    /** 추이 — metric 들을 bucketMinutes 단위로 평균·최대 집계. */
    async series(metrics: string[], hours: number, bucketMinutes: number): Promise<Array<NodeMetricSeriesPoint & { metric: string }>> {
        const r = await this.query<NodeMetricSeriesPoint & { metric: string }>(
            `SELECT to_timestamp(floor(extract(epoch FROM sampled_at) / ($3 * 60)) * ($3 * 60)) AS bucket,
                    metric, node_id, labels, avg(value)::float8 AS avg, max(value)::float8 AS max
             FROM node_metrics_samples
             WHERE metric = ANY($1) AND sampled_at >= NOW() - make_interval(hours => $2)
             GROUP BY 1, metric, node_id, labels
             ORDER BY 1 ASC`,
            [metrics, hours, bucketMinutes],
        );
        return r.rows;
    }

    async purge(retentionDays: number): Promise<number> {
        const r = await this.query('DELETE FROM node_metrics_samples WHERE sampled_at < NOW() - make_interval(days => $1)', [retentionDays]);
        return r.rowCount ?? 0;
    }
}
