/**
 * Metrics Collector
 * 시스템 메트릭을 수집하고 관리합니다.
 */

import { EventEmitter } from 'events';

// 메트릭 타입
export interface Metric {
    name: string;
    value: number;
    unit: string;
    timestamp: Date;
    labels?: Record<string, string>;
}

// 통계 인터페이스
export interface MetricStats {
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
}

// 채팅 메트릭
export interface ChatMetrics {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalTokens: number;
    avgResponseTime: number;
    activeConnections: number;
}

// 시스템 메트릭
export interface SystemMetrics {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    activeWebSockets: number;
}

class MetricsCollector extends EventEmitter {
    private metrics: Map<string, number[]> = new Map();
    private counters: Map<string, number> = new Map();
    private gauges: Map<string, number> = new Map();
    private startTime: Date = new Date();
    private windowSize: number = 1000;  // 최대 샘플 수

    constructor() {
        super();
    }

    /**
     * 카운터 증가
     */
    incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
        const key = this.buildKey(name, labels);
        const current = this.counters.get(key) || 0;
        this.counters.set(key, current + value);
        this.emit('counter', { name, value: current + value, labels });
    }

    /**
     * 게이지 설정
     */
    setGauge(name: string, value: number, labels?: Record<string, string>): void {
        const key = this.buildKey(name, labels);
        this.gauges.set(key, value);
        this.emit('gauge', { name, value, labels });
    }

    /**
     * 히스토그램에 값 추가
     */
    recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
        const key = this.buildKey(name, labels);
        let values = this.metrics.get(key);

        if (!values) {
            values = [];
            this.metrics.set(key, values);
        }

        values.push(value);

        // 윈도우 크기 유지
        if (values.length > this.windowSize) {
            values.shift();
        }

        this.emit('histogram', { name, value, labels });
    }

    /**
     * 응답 시간 기록
     */
    recordResponseTime(duration: number, model?: string): void {
        this.recordHistogram('response_time_ms', duration, { model: model || 'unknown' });
        this.incrementCounter('requests_total', 1, { model: model || 'unknown' });
    }

    /**
     * 토큰 사용량 기록
     */
    recordTokenUsage(tokens: number, model?: string): void {
        this.recordHistogram('tokens_used', tokens, { model: model || 'unknown' });
        this.incrementCounter('tokens_total', tokens, { model: model || 'unknown' });
    }

    /**
     * 에러 기록
     */
    recordError(errorType: string): void {
        this.incrementCounter('errors_total', 1, { type: errorType });
    }

    /**
     * 히스토그램 통계 계산
     */
    getHistogramStats(name: string, labels?: Record<string, string>): MetricStats | null {
        const key = this.buildKey(name, labels);
        const values = this.metrics.get(key);

        if (!values || values.length === 0) {
            return null;
        }

        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);

        return {
            count: values.length,
            sum,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: sum / values.length,
            p50: this.percentile(sorted, 50),
            p95: this.percentile(sorted, 95),
            p99: this.percentile(sorted, 99)
        };
    }

    /**
     * 카운터 값 조회
     */
    getCounter(name: string, labels?: Record<string, string>): number {
        const key = this.buildKey(name, labels);
        return this.counters.get(key) || 0;
    }

    /**
     * 게이지 값 조회
     */
    getGauge(name: string, labels?: Record<string, string>): number {
        const key = this.buildKey(name, labels);
        return this.gauges.get(key) || 0;
    }

    /**
     * 채팅 메트릭 요약
     */
    getChatMetrics(): ChatMetrics {
        const responseStats = this.getHistogramStats('response_time_ms');

        return {
            totalRequests: this.getCounter('requests_total'),
            successfulRequests: this.getCounter('requests_total') - this.getCounter('errors_total'),
            failedRequests: this.getCounter('errors_total'),
            totalTokens: this.getCounter('tokens_total'),
            avgResponseTime: responseStats?.avg || 0,
            activeConnections: this.getGauge('active_connections')
        };
    }

    /**
     * 시스템 메트릭
     */
    getSystemMetrics(): SystemMetrics {
        return {
            uptime: (Date.now() - this.startTime.getTime()) / 1000,
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
            activeWebSockets: this.getGauge('active_websockets')
        };
    }

    /**
     * 전체 메트릭 덤프
     */
    getAllMetrics(): Record<string, any> {
        return {
            counters: Object.fromEntries(this.counters),
            gauges: Object.fromEntries(this.gauges),
            histograms: Object.fromEntries(
                Array.from(this.metrics.entries()).map(([key, values]) => [
                    key,
                    this.getHistogramStats(key)
                ])
            ),
            chat: this.getChatMetrics(),
            system: this.getSystemMetrics(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * 메트릭 초기화
     */
    reset(): void {
        this.metrics.clear();
        this.counters.clear();
        this.gauges.clear();
        this.startTime = new Date();
    }

    /**
     * 키 생성 (라벨 포함)
     */
    private buildKey(name: string, labels?: Record<string, string>): string {
        if (!labels || Object.keys(labels).length === 0) {
            return name;
        }
        const labelStr = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
        return `${name}{${labelStr}}`;
    }

    /**
     * 백분위수 계산
     */
    private percentile(sortedValues: number[], p: number): number {
        const index = Math.ceil((p / 100) * sortedValues.length) - 1;
        return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
    }
}

// 싱글톤 인스턴스
let metricsInstance: MetricsCollector | null = null;

export function getMetrics(): MetricsCollector {
    if (!metricsInstance) {
        metricsInstance = new MetricsCollector();
    }
    return metricsInstance;
}

export { MetricsCollector };
