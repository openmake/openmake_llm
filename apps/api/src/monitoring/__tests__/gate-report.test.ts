import {
    buildGateVerdicts,
    escapeHtml,
    gateReportDateStr,
    gateReportWeekday,
    renderGateReportHtml,
    GateReportInput,
} from '../gate-report';

function makeInput(overrides?: Partial<GateReportInput>): GateReportInput {
    return {
        workflow: {
            totalTasks: 120,
            retryTasks: 18,
            hitlDegradeTasks: 7,
            planCoverage: 0.85,
            completedTasks: 90,
            unjudgedRate: 0.2,
            goalIncompleteTasks: 3,
        },
        orchestration: { totalTurns: 800, exposedTurns: 60, calledTurns: 20, successTurns: 18 },
        ...overrides,
    };
}

describe('gate-report 순수 헬퍼', () => {
    it('gateReportDateStr: TZ 기준 날짜 — UTC 자정 직전도 Seoul 은 다음날', () => {
        // 2026-08-23(일) 23:30 UTC = Seoul 2026-08-24(월) 08:30
        const now = new Date('2026-08-23T23:30:00Z');
        expect(gateReportDateStr(now, 'Asia/Seoul')).toBe('2026-08-24');
        expect(gateReportDateStr(now, 'UTC')).toBe('2026-08-23');
    });

    it('gateReportWeekday: ISO 요일 (1=월) — TZ 경계에서 요일이 갈린다', () => {
        const now = new Date('2026-08-23T23:30:00Z');
        expect(gateReportWeekday(now, 'Asia/Seoul')).toBe(1); // 월
        expect(gateReportWeekday(now, 'UTC')).toBe(7); // 일
    });

    it('escapeHtml: 태그·따옴표 이스케이프', () => {
        expect(escapeHtml('<script>"a"&b</script>')).toBe(
            '&lt;script&gt;&quot;a&quot;&amp;b&lt;/script&gt;'
        );
    });
});

describe('buildGateVerdicts', () => {
    it('표본 충분 시 2개 게이트 모두 판정 가능', () => {
        const verdicts = buildGateVerdicts(makeInput(), 30);
        expect(verdicts).toHaveLength(2);
        expect(verdicts.every((v) => v.tone === 'ok')).toBe(true);
    });

    it('반려된 tail 게이트는 판정 대상에서 제외된다 (2026-08-22)', () => {
        const verdicts = buildGateVerdicts(makeInput(), 30);
        expect(verdicts.some((v) => /tail/i.test(v.gate))).toBe(false);
    });

    it('표본 부족 시 warn 톤 — 계속 관측', () => {
        const verdicts = buildGateVerdicts(
            makeInput({ orchestration: { totalTurns: 10, exposedTurns: 5, calledTurns: 2, successTurns: 2 } }),
            30
        );
        const orch = verdicts[1];
        expect(orch.tone).toBe('warn');
        expect(orch.status).toContain('표본 부족');
    });

});

describe('renderGateReportHtml', () => {
    it('템플릿 placeholder 치환 + 판정·상세 섹션 포함', async () => {
        const html = await renderGateReportHtml(makeInput(), 7, '2026-08-24');
        expect(html).toContain('2026-08-24');
        expect(html).toContain('최근 7일');
        expect(html).not.toContain('{{'); // placeholder 잔존 없음
        expect(html).toContain('Execution Graph');
        expect(html).toContain('오케스트레이션 자동 배정 상세');
        expect(html).not.toContain('Tail 셰도우 상세'); // 반려된 게이트는 렌더되지 않는다
    });

    it('동적 값 escape — 날짜 파라미터에 태그가 섞여도 그대로 출력되지 않는다', async () => {
        const html = await renderGateReportHtml(makeInput(), 7, '<img src=x>');
        expect(html).not.toContain('<img src=x>');
        expect(html).toContain('&lt;img src=x&gt;');
    });
});
