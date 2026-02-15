/**
 * ============================================================
 * Metrics Collector - 시스템 메트릭 수집 및 통계 엔진
 * ============================================================
 *
 * 카운터, 게이지, 히스토그램 3가지 메트릭 타입을 지원하는 수집기.
 * 응답 시간, 토큰 사용량, 에러율 등 시스템 성능 지표를 실시간 추적합니다.
 *
 * @module monitoring/metrics
 * @description
 * - 카운터: 누적 증가 값 (요청 수, 토큰 총합, 에러 수)
 * - 게이지: 현재 상태 값 (활성 연결 수, WebSocket 수)
 * - 히스토그램: 분포 통계 (응답 시간, 토큰 사용량) + 백분위수(p50/p95/p99)
 * - 라벨 기반 메트릭 분류 (모델별, 에러 타입별)
 * - EventEmitter 기반 메트릭 변경 이벤트 발행
 * - 싱글톤 패턴으로 전역 인스턴스 관리
 */

import { EventEmitter } from 'events';

/**
 * 개별 메트릭 데이터 포인트 인터페이스
 *
 * @interface Metric
 */
export interface Metric {
    /** 메트릭 이름 (예: 'response_time_ms', 'tokens_used') */
    name: string;
    /** 메트릭 값 */
    value: number;
    /** 측정 단위 (예: 'ms', 'count', 'bytes') */
    unit: string;
    /** 기록 시점의 타임스탬프 */
    timestamp: Date;
    /** 메트릭 분류 라벨 (예: { model: 'gpt-4' }) */
    labels?: Record<string, string>;
}

/**
 * 히스토그램 통계 결과 인터페이스
 *
 * @interface MetricStats
 */
export interface MetricStats {
    /** 샘플 수 */
    count: number;
    /** 값의 합계 */
    sum: number;
    /** 최솟값 */
    min: number;
    /** 최댓값 */
    max: number;
    /** 평균값 */
    avg: number;
    /** 50번째 백분위수 (중앙값) */
    p50: number;
    /** 95번째 백분위수 */
    p95: number;
    /** 99번째 백분위수 */
    p99: number;
}

/**
 * 채팅 서비스 메트릭 요약 인터페이스
 *
 * @interface ChatMetrics
 */
export interface ChatMetrics {
    /** 총 요청 수 */
    totalRequests: number;
    /** 성공한 요청 수 */
    successfulRequests: number;
    /** 실패한 요청 수 */
    failedRequests: number;
    /** 총 사용 토큰 수 */
    totalTokens: number;
    /** 평균 응답 시간 (ms) */
    avgResponseTime: number;
    /** 현재 활성 연결 수 */
    activeConnections: number;
}

/**
 * 시스템 리소스 메트릭 인터페이스
 *
 * @interface SystemMetrics
 */
export interface SystemMetrics {
    /** 서버 가동 시간 (초) */
    uptime: number;
    /** Node.js 메모리 사용량 (heap, rss, external 등) */
    memoryUsage: NodeJS.MemoryUsage;
    /** Node.js CPU 사용량 (user, system 마이크로초) */
    cpuUsage: NodeJS.CpuUsage;
    /** 현재 활성 WebSocket 연결 수 */
    activeWebSockets: number;
}

/**
 * 시스템 메트릭 수집기 클래스
 *
 * 카운터, 게이지, 히스토그램 3가지 메트릭 타입을 관리하며,
 * EventEmitter를 상속하여 메트릭 변경 시 이벤트를 발행합니다.
 * 히스토그램은 슬라이딩 윈도우 방식으로 최대 1,000개 샘플을 유지합니다.
 *
 * @class MetricsCollector
 * @extends EventEmitter
 */
class MetricsCollector extends EventEmitter {
    /** 히스토그램 데이터 저장소 (키: 메트릭명{라벨}, 값: 숫자 배열) */
    private metrics: Map<string, number[]> = new Map();
    /** 카운터 저장소 (누적 증가 값) */
    private counters: Map<string, number> = new Map();
    /** 게이지 저장소 (현재 상태 값) */
    private gauges: Map<string, number> = new Map();
    /** 서버 시작 시간 */
    private startTime: Date = new Date();
    /** 히스토그램 슬라이딩 윈도우 최대 샘플 수 */
    private windowSize: number = 1000;  // 최대 샘플 수

    constructor() {
        super();
    }

    /**
     * 카운터를 지정된 값만큼 증가시킵니다.
     *
     * @param name - 카운터 이름
     * @param value - 증가량 (기본값: 1)
     * @param labels - 메트릭 분류 라벨
     */
    incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
        const key = this.buildKey(name, labels);
        const current = this.counters.get(key) || 0;
        this.counters.set(key, current + value);
        this.emit('counter', { name, value: current + value, labels });
    }

    /**
     * 게이지 값을 설정합니다.
     *
     * @param name - 게이지 이름
     * @param value - 설정할 값
     * @param labels - 메트릭 분류 라벨
     */
    setGauge(name: string, value: number, labels?: Record<string, string>): void {
        const key = this.buildKey(name, labels);
        this.gauges.set(key, value);
        this.emit('gauge', { name, value, labels });
    }

    /**
     * 히스토그램에 값을 추가합니다.
     *
     * 슬라이딩 윈도우 방식으로 windowSize * 1.5 초과 시 배치 트렁케이션을 수행합니다.
     *
     * @param name - 히스토그램 이름
     * @param value - 기록할 값
     * @param labels - 메트릭 분류 라벨
     */
    recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
        const key = this.buildKey(name, labels);
        let values = this.metrics.get(key);

        if (!values) {
            values = [];
            this.metrics.set(key, values);
        }

        values.push(value);

        // 윈도우 크기 유지 — batch truncation으로 shift()의 O(n) 반복 방지
        if (values.length > this.windowSize * 1.5) {
            const excess = values.length - this.windowSize;
            values.splice(0, excess);
        }

        this.emit('histogram', { name, value, labels });
    }

    /**
     * 응답 시간을 기록합니다.
     *
     * 히스토그램과 카운터를 동시에 업데이트합니다.
     *
     * @param duration - 응답 시간 (ms)
     * @param model - LLM 모델 이름 (기본값: 'unknown')
     */
    recordResponseTime(duration: number, model?: string): void {
        this.recordHistogram('response_time_ms', duration, { model: model || 'unknown' });
        this.incrementCounter('requests_total', 1, { model: model || 'unknown' });
    }

    /**
     * 토큰 사용량을 기록합니다.
     *
     * @param tokens - 사용된 토큰 수
     * @param model - LLM 모델 이름 (기본값: 'unknown')
     */
    recordTokenUsage(tokens: number, model?: string): void {
        this.recordHistogram('tokens_used', tokens, { model: model || 'unknown' });
        this.incrementCounter('tokens_total', tokens, { model: model || 'unknown' });
    }

    /**
     * 에러 발생을 기록합니다.
     *
     * @param errorType - 에러 유형 문자열
     */
    recordError(errorType: string): void {
        this.incrementCounter('errors_total', 1, { type: errorType });
    }

    /**
     * 히스토그램의 통계를 계산합니다.
     *
     * 정렬 후 count, sum, min, max, avg, p50, p95, p99를 산출합니다.
     *
     * @param name - 히스토그램 이름
     * @param labels - 메트릭 분류 라벨
     * @returns 통계 결과 또는 데이터가 없으면 null
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
     * 카운터 현재 값을 조회합니다.
     *
     * @param name - 카운터 이름
     * @param labels - 메트릭 분류 라벨
     * @returns 카운터 값 (없으면 0)
     */
    getCounter(name: string, labels?: Record<string, string>): number {
        const key = this.buildKey(name, labels);
        return this.counters.get(key) || 0;
    }

    /**
     * 게이지 현재 값을 조회합니다.
     *
     * @param name - 게이지 이름
     * @param labels - 메트릭 분류 라벨
     * @returns 게이지 값 (없으면 0)
     */
    getGauge(name: string, labels?: Record<string, string>): number {
        const key = this.buildKey(name, labels);
        return this.gauges.get(key) || 0;
    }

    /**
     * 채팅 서비스 메트릭 요약을 반환합니다.
     *
     * 총 요청 수, 성공/실패 수, 토큰 총합, 평균 응답 시간, 활성 연결 수를 집계합니다.
     *
     * @returns 채팅 메트릭 요약 객체
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
     * 시스템 리소스 메트릭을 반환합니다.
     *
     * 서버 가동 시간, 메모리/CPU 사용량, 활성 WebSocket 수를 포함합니다.
     *
     * @returns 시스템 메트릭 객체
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
     * 모든 메트릭을 JSON 형태로 덤프합니다.
     *
     * 카운터, 게이지, 히스토그램 통계, 채팅 메트릭, 시스템 메트릭을 포함합니다.
     *
     * @returns 전체 메트릭 덤프 객체
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
     * 모든 메트릭 데이터를 초기화합니다.
     *
     * 카운터, 게이지, 히스토그램을 모두 삭제하고 시작 시간을 리셋합니다.
     */
    reset(): void {
        this.metrics.clear();
        this.counters.clear();
        this.gauges.clear();
        this.startTime = new Date();
    }

    /**
     * 메트릭 이름과 라벨을 결합하여 고유 키를 생성합니다.
     *
     * 라벨이 있으면 `name{key1="val1",key2="val2"}` 형식으로 생성합니다.
     *
     * @param name - 메트릭 이름
     * @param labels - 메트릭 분류 라벨
     * @returns 고유 키 문자열
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
     * 정렬된 배열에서 백분위수를 계산합니다.
     *
     * @param sortedValues - 오름차순 정렬된 숫자 배열
     * @param p - 백분위수 (0-100)
     * @returns 해당 백분위수 값
     */
    private percentile(sortedValues: number[], p: number): number {
        const index = Math.ceil((p / 100) * sortedValues.length) - 1;
        return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
    }
}

/** 싱글톤 인스턴스 */
let metricsInstance: MetricsCollector | null = null;

/**
 * MetricsCollector 싱글톤 인스턴스를 반환합니다.
 *
 * 최초 호출 시 인스턴스를 생성하고, 이후 동일 인스턴스를 재사용합니다.
 *
 * @returns MetricsCollector 싱글톤 인스턴스
 */
export function getMetrics(): MetricsCollector {
    if (!metricsInstance) {
        metricsInstance = new MetricsCollector();
    }
    return metricsInstance;
}

export { MetricsCollector };
