/**
 * renderPromText — 인메모리 MetricsCollector 스냅샷을 Prometheus 텍스트 포맷(0.0.4)으로 (R9-a)
 */
import { MetricsCollector } from '../metrics';
import { renderPromText } from '../prom-exposition';

describe('renderPromText', () => {
    test('카운터·게이지·히스토그램(summary) — 정확한 출력', () => {
        const m = new MetricsCollector();
        m.incrementCounter('requests_total', 3, { route: '/x', method: 'GET' });
        m.setGauge('active_connections', 2);
        for (const v of [1, 2, 3]) m.recordHistogram('response_time_ms', v, { model: 'm1' });

        expect(renderPromText(m.getAllMetrics())).toBe(
            '# TYPE requests_total counter\n'
            + 'requests_total{method="GET",route="/x"} 3\n'
            + '# TYPE active_connections gauge\n'
            + 'active_connections 2\n'
            + '# TYPE response_time_ms summary\n'
            + 'response_time_ms{model="m1",quantile="0.5"} 2\n'
            + 'response_time_ms{model="m1",quantile="0.95"} 3\n'
            + 'response_time_ms{model="m1",quantile="0.99"} 3\n'
            + '# TYPE response_time_ms_window_sum gauge\n'
            + 'response_time_ms_window_sum{model="m1"} 6\n'
            + '# TYPE response_time_ms_window_count gauge\n'
            + 'response_time_ms_window_count{model="m1"} 3\n',
        );
    });

    test('라벨 없는 히스토그램 → name{quantile=…}·name_window_sum·name_window_count(게이지)', () => {
        const m = new MetricsCollector();
        m.recordHistogram('lat', 5);
        expect(renderPromText(m.getAllMetrics())).toBe(
            '# TYPE lat summary\n'
            + 'lat{quantile="0.5"} 5\n'
            + 'lat{quantile="0.95"} 5\n'
            + 'lat{quantile="0.99"} 5\n'
            + '# TYPE lat_window_sum gauge\n'
            + 'lat_window_sum 5\n'
            + '# TYPE lat_window_count gauge\n'
            + 'lat_window_count 1\n',
        );
    });

    test('라벨 값의 "·\\·줄바꿈을 Prometheus 규칙대로 이스케이프한다', () => {
        const m = new MetricsCollector();
        m.incrementCounter('esc_total', 1, { v: 'a"b\\c\nd' });
        expect(renderPromText(m.getAllMetrics())).toBe(
            '# TYPE esc_total counter\n'
            + 'esc_total{v="a\\"b\\\\c\\nd"} 1\n',
        );
    });

    test('이름 치환 a.b-c → a_b_c, 같은 이름의 # TYPE 은 한 번, 이름·라벨 정렬', () => {
        const m = new MetricsCollector();
        m.incrementCounter('zeta', 1);
        m.incrementCounter('a.b-c', 2, { k: 'v2' });
        m.incrementCounter('a.b-c', 1, { k: 'v1' });
        expect(renderPromText(m.getAllMetrics())).toBe(
            '# TYPE a_b_c counter\n'
            + 'a_b_c{k="v1"} 1\n'
            + 'a_b_c{k="v2"} 2\n'
            + '# TYPE zeta counter\n'
            + 'zeta 1\n',
        );
    });

    test('NaN·Infinity 값은 줄을 생략한다', () => {
        const m = new MetricsCollector();
        m.setGauge('bad', Number.NaN);
        m.setGauge('inf', Number.POSITIVE_INFINITY);
        m.setGauge('ok', 1.5);
        expect(renderPromText(m.getAllMetrics())).toBe('# TYPE ok gauge\nok 1.5\n');
    });

    test('빈 입력 → ""', () => {
        expect(renderPromText(new MetricsCollector().getAllMetrics())).toBe('');
    });
});
