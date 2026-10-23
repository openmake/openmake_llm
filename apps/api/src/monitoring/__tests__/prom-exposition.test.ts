/**
 * renderPromText — 인메모리 MetricsCollector 스냅샷을 Prometheus 텍스트 포맷(0.0.4)으로 (R9-a)
 */
import { createHash } from 'crypto';
import { MetricsCollector } from '../metrics';
import { renderPromText } from '../prom-exposition';

type Snapshot = Parameters<typeof renderPromText>[0];
/** 충돌한 패밀리의 안정 suffix 계약 — 원본 종류·이름(+시도 번호)의 sha256 앞 8자 */
const h = (kind: 'counter' | 'gauge' | 'summary', raw: string, attempt = 0): string =>
    createHash('sha256').update(`${kind}\0${raw}\0${attempt}`).digest('hex').slice(0, 8);
const st = (v: number) => ({ count: 1, sum: v, min: v, max: v, avg: v, p50: v, p95: v, p99: v });
const snap = (parts: { counters?: Record<string, number>; gauges?: Record<string, number>; histograms?: Record<string, unknown> }): Snapshot =>
    ({ counters: parts.counters ?? {}, gauges: parts.gauges ?? {}, histograms: parts.histograms ?? {} });
const reverse = (s: Snapshot): Snapshot => Object.fromEntries(Object.entries(s).map(([k, v]) =>
    [k, v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse()) : v]));

/** 전체 출력 검사 — 이름 형식, # TYPE 이름 중복 없음, 같은 이름+라벨 시계열 중복 없음, 샘플은 직전 TYPE 패밀리 소속 */
function expectWellFormed(text: string): void {
    const types = new Set<string>();
    const samples = new Set<string>();
    let current = '';
    for (const line of text.trimEnd().split('\n')) {
        const t = /^# TYPE (\S+) (counter|gauge|summary)$/.exec(line);
        if (t) {
            expect(types.has(t[1])).toBe(false);
            types.add(t[1]);
            current = t[1];
            continue;
        }
        const name = /^[^{ ]+/.exec(line)![0];
        expect(name).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*$/);
        expect(name).toBe(current);
        const series = line.slice(0, line.lastIndexOf(' '));
        expect(samples.has(series)).toBe(false);
        samples.add(series);
    }
}

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

    describe('전체 export 이름 충돌 — 결정적·안정 이름 배정(#1477)', () => {
        test('치환 충돌 a-b / a_b — 이미 유효한 a_b 는 그대로, a-b 는 원본 identity suffix', () => {
            const text = renderPromText(snap({ counters: { 'a-b{k="v"}': 2, 'a_b{k="v"}': 1 } }));
            expect(text).toBe(
                '# TYPE a_b counter\n'
                + 'a_b{k="v"} 1\n'
                + `# TYPE a_b_${h('counter', 'a-b')} counter\n`
                + `a_b_${h('counter', 'a-b')}{k="v"} 2\n`,
            );
            expectWellFormed(text);
        });

        test('타입 간 충돌 counter x / gauge x — TYPE 한 이름에 두 종류를 섞지 않는다', () => {
            const text = renderPromText(snap({ counters: { x: 1 }, gauges: { x: 2 } }));
            expect(text).toBe(
                '# TYPE x counter\n'
                + 'x 1\n'
                + `# TYPE x_${h('gauge', 'x')} gauge\n`
                + `x_${h('gauge', 'x')} 2\n`,
            );
            expectWellFormed(text);
        });

        test('summary 파생 이름(_window_sum)과 같은 이름의 원본 게이지 — summary 패밀리 전체가 함께 이동', () => {
            const H = `lat_${h('summary', 'lat')}`;
            const text = renderPromText(snap({ gauges: { lat_window_sum: 7 }, histograms: { lat: st(5) } }));
            expect(text).toBe(
                '# TYPE lat_window_sum gauge\n'
                + 'lat_window_sum 7\n'
                + `# TYPE ${H} summary\n`
                + `${H}{quantile="0.5"} 5\n`
                + `${H}{quantile="0.95"} 5\n`
                + `${H}{quantile="0.99"} 5\n`
                + `# TYPE ${H}_window_sum gauge\n`
                + `${H}_window_sum 5\n`
                + `# TYPE ${H}_window_count gauge\n`
                + `${H}_window_count 1\n`,
            );
            expectWellFormed(text);
        });

        test('summary 의 Prometheus 예약 이름(_count·_sum)과 같은 원본 게이지도 충돌로 본다', () => {
            const H = `lat_${h('summary', 'lat')}`;
            const text = renderPromText(snap({ gauges: { lat_count: 3 }, histograms: { lat: st(5) } }));
            expect(text).not.toContain('# TYPE lat summary');
            expect(text).toContain('# TYPE lat_count gauge\nlat_count 3\n');
            expect(text).toContain(`# TYPE ${H} summary\n`);
            expectWellFormed(text);
        });

        test('숫자로 시작하는 이름 → _ 접두, 이미 유효한 같은 이름이 있으면 그쪽이 유지된다', () => {
            expect(renderPromText(snap({ counters: { '1st': 1 }, histograms: { '9lat': st(2) } }))).toBe(
                '# TYPE _1st counter\n'
                + '_1st 1\n'
                + '# TYPE _9lat summary\n'
                + '_9lat{quantile="0.5"} 2\n'
                + '_9lat{quantile="0.95"} 2\n'
                + '_9lat{quantile="0.99"} 2\n'
                + '# TYPE _9lat_window_sum gauge\n'
                + '_9lat_window_sum 2\n'
                + '# TYPE _9lat_window_count gauge\n'
                + '_9lat_window_count 1\n',
            );
            const text = renderPromText(snap({ counters: { '1st': 1 }, gauges: { _1st: 2 } }));
            expect(text).toBe(
                `# TYPE _1st_${h('counter', '1st')} counter\n`
                + `_1st_${h('counter', '1st')} 1\n`
                + '# TYPE _1st gauge\n'
                + '_1st 2\n',
            );
            expectWellFormed(text);
        });

        test('생성한 suffix 이름이 다른 원본 이름과 겹치면 다음 시도 suffix 로 넘어간다', () => {
            const trap = `a_b_${h('counter', 'a-b')}`;
            const text = renderPromText(snap({ counters: { 'a-b': 2, a_b: 1, [trap]: 3 } }));
            expect(text).toContain(`# TYPE ${trap} counter\n${trap} 3\n`);
            expect(text).toContain(`# TYPE a_b_${h('counter', 'a-b', 1)} counter\na_b_${h('counter', 'a-b', 1)} 2\n`);
            expectWellFormed(text);
        });

        test('입력 순서를 뒤집어도 출력이 같다 — 전체 충돌 묶음', () => {
            const s = snap({
                counters: { 'a-b{k="v"}': 2, 'a_b{k="v"}': 1, x: 1, '1st': 1, [`a_b_${h('counter', 'a-b')}`]: 4 },
                gauges: { x: 2, lat_window_sum: 7, _1st: 2, 'a.b': 9 },
                histograms: { lat: st(5), 'lat{m="1"}': st(6), x: st(1), 'a_b': st(3) },
            });
            const forward = renderPromText(s);
            expect(renderPromText(reverse(s))).toBe(forward);
            expectWellFormed(forward);
        });
    });
});
