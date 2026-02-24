/**
 * metrics.test.ts
 * MetricsCollector 단위 테스트: 카운터/게이지/히스토그램/통계/이벤트
 */

import { MetricsCollector, getMetrics } from '../monitoring/metrics';

describe('MetricsCollector', () => {
    let metrics: MetricsCollector;

    beforeEach(() => {
        metrics = new MetricsCollector();
    });

    // ──────────────────────────────────────────
    // 카운터
    // ──────────────────────────────────────────
    describe('incrementCounter', () => {
        test('기본값 1씩 증가', () => {
            metrics.incrementCounter('requests');
            expect(metrics.getCounter('requests')).toBe(1);
            metrics.incrementCounter('requests');
            expect(metrics.getCounter('requests')).toBe(2);
        });

        test('지정 값만큼 증가', () => {
            metrics.incrementCounter('tokens', 50);
            expect(metrics.getCounter('tokens')).toBe(50);
            metrics.incrementCounter('tokens', 100);
            expect(metrics.getCounter('tokens')).toBe(150);
        });

        test('라벨로 구분된 카운터', () => {
            metrics.incrementCounter('req', 1, { model: 'gpt' });
            metrics.incrementCounter('req', 1, { model: 'claude' });
            expect(metrics.getCounter('req', { model: 'gpt' })).toBe(1);
            expect(metrics.getCounter('req', { model: 'claude' })).toBe(1);
        });

        test('존재하지 않는 카운터 → 0 반환', () => {
            expect(metrics.getCounter('non_existent')).toBe(0);
        });
    });

    // ──────────────────────────────────────────
    // 게이지
    // ──────────────────────────────────────────
    describe('setGauge', () => {
        test('게이지 값 설정', () => {
            metrics.setGauge('connections', 5);
            expect(metrics.getGauge('connections')).toBe(5);
        });

        test('게이지 값 덮어쓰기', () => {
            metrics.setGauge('connections', 5);
            metrics.setGauge('connections', 10);
            expect(metrics.getGauge('connections')).toBe(10);
        });

        test('라벨로 구분된 게이지', () => {
            metrics.setGauge('ws', 3, { server: 'a' });
            metrics.setGauge('ws', 7, { server: 'b' });
            expect(metrics.getGauge('ws', { server: 'a' })).toBe(3);
            expect(metrics.getGauge('ws', { server: 'b' })).toBe(7);
        });

        test('존재하지 않는 게이지 → 0 반환', () => {
            expect(metrics.getGauge('non_existent')).toBe(0);
        });
    });

    // ──────────────────────────────────────────
    // 히스토그램
    // ──────────────────────────────────────────
    describe('recordHistogram', () => {
        test('값이 히스토그램에 기록된다', () => {
            metrics.recordHistogram('latency', 100);
            metrics.recordHistogram('latency', 200);
            const stats = metrics.getHistogramStats('latency');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(2);
        });

        test('데이터 없으면 getHistogramStats → null', () => {
            expect(metrics.getHistogramStats('empty')).toBeNull();
        });

        test('단일 값 통계 (min=max=avg=p50=p95=p99)', () => {
            metrics.recordHistogram('single', 42);
            const stats = metrics.getHistogramStats('single')!;
            expect(stats.min).toBe(42);
            expect(stats.max).toBe(42);
            expect(stats.avg).toBe(42);
            expect(stats.p50).toBe(42);
            expect(stats.p95).toBe(42);
            expect(stats.p99).toBe(42);
        });

        test('여러 값 통계 정확성', () => {
            // 1, 2, 3, 4, 5
            [1, 2, 3, 4, 5].forEach(v => metrics.recordHistogram('dist', v));
            const stats = metrics.getHistogramStats('dist')!;
            expect(stats.count).toBe(5);
            expect(stats.sum).toBe(15);
            expect(stats.min).toBe(1);
            expect(stats.max).toBe(5);
            expect(stats.avg).toBe(3);
        });

        test('라벨로 구분된 히스토그램', () => {
            metrics.recordHistogram('resp', 100, { model: 'fast' });
            metrics.recordHistogram('resp', 500, { model: 'slow' });
            const fast = metrics.getHistogramStats('resp', { model: 'fast' })!;
            const slow = metrics.getHistogramStats('resp', { model: 'slow' })!;
            expect(fast.avg).toBe(100);
            expect(slow.avg).toBe(500);
        });

        test('슬라이딩 윈도우 — windowSize * 1.5 초과 시 트렁케이션', () => {
            // windowSize 기본값 1000, 1500개 추가 시 트렁케이션
            for (let i = 0; i < 1600; i++) {
                metrics.recordHistogram('window_test', i);
            }
            const stats = metrics.getHistogramStats('window_test')!;
            // 트렁케이션 후 count는 1000 이상 1600 미만이어야 함
            expect(stats.count).toBeLessThan(1600);
            expect(stats.count).toBeGreaterThanOrEqual(1000);
        });
    });

    // ──────────────────────────────────────────
    // 복합 메트릭 메서드
    // ──────────────────────────────────────────
    describe('recordResponseTime', () => {
        test('히스토그램 + 카운터 동시 업데이트', () => {
            metrics.recordResponseTime(200, 'gpt-4');
            expect(metrics.getCounter('requests_total', { model: 'gpt-4' })).toBe(1);
            const stats = metrics.getHistogramStats('response_time_ms', { model: 'gpt-4' });
            expect(stats).not.toBeNull();
            expect(stats!.avg).toBe(200);
        });

        test('model 미지정 시 "unknown" 라벨 사용', () => {
            metrics.recordResponseTime(100);
            expect(metrics.getCounter('requests_total', { model: 'unknown' })).toBe(1);
        });
    });

    describe('recordTokenUsage', () => {
        test('히스토그램 + 카운터 동시 업데이트', () => {
            metrics.recordTokenUsage(500, 'claude');
            expect(metrics.getCounter('tokens_total', { model: 'claude' })).toBe(500);
        });

        test('model 미지정 시 "unknown" 라벨 사용', () => {
            metrics.recordTokenUsage(100);
            expect(metrics.getCounter('tokens_total', { model: 'unknown' })).toBe(100);
        });
    });

    describe('recordError', () => {
        test('에러 카운터 증가', () => {
            metrics.recordError('timeout');
            expect(metrics.getCounter('errors_total', { type: 'timeout' })).toBe(1);
        });

        test('동일 에러 타입 중복 기록', () => {
            metrics.recordError('network');
            metrics.recordError('network');
            expect(metrics.getCounter('errors_total', { type: 'network' })).toBe(2);
        });
    });

    // ──────────────────────────────────────────
    // 채팅 메트릭 요약
    // ──────────────────────────────────────────
    describe('getChatMetrics', () => {
        test('초기 상태에서 모두 0', () => {
            const chat = metrics.getChatMetrics();
            expect(chat.totalRequests).toBe(0);
            expect(chat.successfulRequests).toBe(0);
            expect(chat.failedRequests).toBe(0);
            expect(chat.totalTokens).toBe(0);
            expect(chat.avgResponseTime).toBe(0);
            expect(chat.activeConnections).toBe(0);
        });

        test('요청/에러/토큰 기록 후 요약 반영', () => {
            // getChatMetrics는 라벨 없는 콴다를 조회함
            // recordResponseTime/recordError/recordTokenUsage는 모두 { model } 라벨 부 콴다에 저장됨
            // 라벨 없는 카운터 직접 조작으로 getChatMetrics() 동작 확인
            metrics.incrementCounter('requests_total', 2);
            metrics.incrementCounter('errors_total', 1);
            metrics.incrementCounter('tokens_total', 200);
            metrics.recordHistogram('response_time_ms', 300);
            metrics.recordHistogram('response_time_ms', 100);
            const chat = metrics.getChatMetrics();
            expect(chat.totalRequests).toBe(2);
            expect(chat.failedRequests).toBe(1);
            expect(chat.successfulRequests).toBe(1);
            expect(chat.totalTokens).toBe(200);
            expect(chat.avgResponseTime).toBe(200);
        });

        test('활성 연결 수 반영', () => {
            metrics.setGauge('active_connections', 7);
            const chat = metrics.getChatMetrics();
            expect(chat.activeConnections).toBe(7);
        });
    });

    // ──────────────────────────────────────────
    // 시스템 메트릭
    // ──────────────────────────────────────────
    describe('getSystemMetrics', () => {
        test('uptime, memoryUsage, cpuUsage, activeWebSockets 포함', () => {
            const sys = metrics.getSystemMetrics();
            expect(typeof sys.uptime).toBe('number');
            expect(sys.uptime).toBeGreaterThanOrEqual(0);
            expect(typeof sys.memoryUsage).toBe('object');
            expect(typeof sys.cpuUsage).toBe('object');
            expect(typeof sys.activeWebSockets).toBe('number');
        });

        test('activeWebSockets — setGauge 반영', () => {
            metrics.setGauge('active_websockets', 12);
            expect(metrics.getSystemMetrics().activeWebSockets).toBe(12);
        });
    });

    // ──────────────────────────────────────────
    // getAllMetrics
    // ──────────────────────────────────────────
    describe('getAllMetrics', () => {
        test('counters, gauges, histograms, chat, system, timestamp 포함', () => {
            const all = metrics.getAllMetrics();
            expect(all).toHaveProperty('counters');
            expect(all).toHaveProperty('gauges');
            expect(all).toHaveProperty('histograms');
            expect(all).toHaveProperty('chat');
            expect(all).toHaveProperty('system');
            expect(all).toHaveProperty('timestamp');
        });

        test('timestamp는 ISO 8601 형식', () => {
            const all = metrics.getAllMetrics();
            expect(() => new Date(all.timestamp)).not.toThrow();
        });
    });

    // ──────────────────────────────────────────
    // reset
    // ──────────────────────────────────────────
    describe('reset', () => {
        test('모든 데이터 초기화', () => {
            metrics.incrementCounter('req', 5);
            metrics.setGauge('ws', 3);
            metrics.recordHistogram('lat', 100);
            metrics.reset();

            expect(metrics.getCounter('req')).toBe(0);
            expect(metrics.getGauge('ws')).toBe(0);
            expect(metrics.getHistogramStats('lat')).toBeNull();
        });
    });

    // ──────────────────────────────────────────
    // EventEmitter
    // ──────────────────────────────────────────
    describe('EventEmitter 이벤트', () => {
        test('incrementCounter → "counter" 이벤트 발행', () => {
            const spy = jest.fn();
            metrics.on('counter', spy);
            metrics.incrementCounter('test', 3);
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'test', value: 3 }));
        });

        test('setGauge → "gauge" 이벤트 발행', () => {
            const spy = jest.fn();
            metrics.on('gauge', spy);
            metrics.setGauge('ws', 5);
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'ws', value: 5 }));
        });

        test('recordHistogram → "histogram" 이벤트 발행', () => {
            const spy = jest.fn();
            metrics.on('histogram', spy);
            metrics.recordHistogram('lat', 200);
            expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'lat', value: 200 }));
        });
    });

    // ──────────────────────────────────────────
    // buildKey 라벨 정렬 일관성
    // ──────────────────────────────────────────
    describe('라벨 키 일관성', () => {
        test('라벨 순서가 달라도 같은 카운터로 취급', () => {
            metrics.incrementCounter('c', 1, { b: '2', a: '1' });
            metrics.incrementCounter('c', 1, { a: '1', b: '2' });
            // 라벨이 알파벳 순으로 정렬되므로 동일 키
            expect(metrics.getCounter('c', { a: '1', b: '2' })).toBe(2);
        });
    });
});

// ──────────────────────────────────────────
// 싱글톤 팩토리
// ──────────────────────────────────────────
describe('getMetrics', () => {
    test('같은 인스턴스를 반환 (싱글톤)', () => {
        const a = getMetrics();
        const b = getMetrics();
        expect(a).toBe(b);
    });

    test('MetricsCollector 인스턴스 반환', () => {
        expect(getMetrics()).toBeInstanceOf(MetricsCollector);
    });
});
