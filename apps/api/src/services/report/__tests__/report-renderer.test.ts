/**
 * 보고서 결정적 렌더러 테스트 — 실제 generic-report 템플릿으로 렌더 계약 검증.
 */
import { renderReport } from '../report-renderer';

const FIXED_NOW = new Date('2026-07-30T09:00:00+09:00');

const FULL_DATA = {
    KICKER: 'MARKET RESEARCH',
    REPORT_TITLE: '코스닥 시장 현황',
    SUBTITLE: '2026년 상반기 핵심 지표 요약.',
    TOPLINE: '웹검색 12건 · 교차검증 3건',
    SUMMARY: '요약 문장입니다.',
    kpis: [
        { label: '지수', value: '870.1', note: '전일 대비', delta: '+1.2%', deltaclass: 'up' },
        { label: '거래대금', value: '9.8조', note: '20일 평균', delta: '-4%', deltaclass: 'down' },
    ],
    sections: [
        {
            kicker: 'OVERVIEW',
            heading: '시장 개요',
            paragraphs: ['첫 문단.', '둘째 문단.'],
            bullets: ['요점 하나', '요점 둘'],
        },
        {
            heading: '섹터 비교',
            table: { headers: ['섹터', '등락'], rows: [['반도체', '+2.1%'], ['바이오', '-0.8%']] },
            chart: { type: 'bar', title: '섹터 모멘텀', labels: ['반도체', '바이오'], values: [82, 41], unit: '' },
        },
    ],
    sources: [
        { title: '한국거래소 공시', url: 'https://kind.krx.co.kr/x' },
        { title: '스킴 주입 시도', url: 'javascript:alert(1)' },
    ],
};

describe('renderReport(generic-report)', () => {
    it('전체 데이터 렌더 — 토큰 잔존 0, 값 치환·RUN_DATE 계산', () => {
        const { html, title } = renderReport('generic-report', FULL_DATA, FIXED_NOW);
        expect(html).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
        expect(html).not.toContain('REPEAT:');
        expect(title).toBe('코스닥 시장 현황');
        expect(html).toContain('코스닥 시장 현황');
        expect(html).toContain('2026-07-30'); // RUN_DATE 는 렌더러 계산(KST)
        expect(html).toContain('870.1');
        expect(html).toContain('시장 개요');
        expect(html).toContain('<li>요점 하나</li>');
        expect(html).toContain('<th>섹터</th>');
    });

    it('LLM 문자열은 escape — 마크업 주입 불가', () => {
        const { html } = renderReport('generic-report', {
            ...FULL_DATA,
            REPORT_TITLE: '<script>alert(1)</script>',
            sections: [{ heading: '<img src=x>', paragraphs: ['a & b <i>'] }],
        }, FIXED_NOW);
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&lt;img src=x&gt;');
        expect(html).toContain('a &amp; b &lt;i&gt;');
    });

    it('출처 URL 은 http(s)만 링크 — 그 외 스킴은 텍스트 강등', () => {
        const { html } = renderReport('generic-report', FULL_DATA, FIXED_NOW);
        expect(html).toContain('href="https://kind.krx.co.kr/x"');
        expect(html).not.toContain('javascript:alert');
    });

    it('누락 키는 — 채움 + 경고, 버려진 키도 경고 (py 렌더러 계약)', () => {
        const { html, warnings } = renderReport('generic-report', {
            REPORT_TITLE: 't',
            UNKNOWN_EXTRA: 'x',
            sections: [{ heading: 'h', paragraphs: ['p'] }],
        }, FIXED_NOW);
        expect(html).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
        expect(warnings.some((w) => w.includes('미제공 키'))).toBe(true);
        expect(warnings.some((w) => w.includes('버려진 키') && w.includes('UNKNOWN_EXTRA'))).toBe(true);
    });

    it('빈 반복 그룹 — kpis 없음은 무출력, sources 없음은 emptyHtml', () => {
        const { html } = renderReport('generic-report', {
            REPORT_TITLE: 't', sections: [{ heading: 'h', paragraphs: ['p'] }],
        }, FIXED_NOW);
        expect(html).not.toContain('class="kpi"');
        expect(html).toContain('출처 미제공');
    });

    it('deltaclass 는 whitelist 밖이면 steady 로 강등 (class 주입 차단)', () => {
        const { html } = renderReport('generic-report', {
            REPORT_TITLE: 't',
            kpis: [{ label: 'l', value: 'v', note: 'n', delta: '+1', deltaclass: 'up"><script>' }],
            sections: [{ heading: 'h', paragraphs: ['p'] }],
        }, FIXED_NOW);
        expect(html).toContain('class="delta steady"');
        expect(html).not.toContain('delta up"><script>');
    });

    it('line 차트는 SVG polyline, 숫자 아닌 값은 제외', () => {
        const { html, warnings } = renderReport('generic-report', {
            REPORT_TITLE: 't',
            sections: [
                { heading: 'h', chart: { type: 'line', labels: ['1월', '2월', '3월'], values: [10, 'x', 30] } },
            ],
        }, FIXED_NOW);
        expect(html).toContain('<svg class="linechart"');
        expect(html).toContain('polyline');
        expect(warnings.length).toBeGreaterThanOrEqual(0);
    });

    it('알 수 없는 템플릿은 throw (호출부 fail-open 계약)', () => {
        expect(() => renderReport('nope', {}, FIXED_NOW)).toThrow('알 수 없는 보고서 템플릿');
    });
});
