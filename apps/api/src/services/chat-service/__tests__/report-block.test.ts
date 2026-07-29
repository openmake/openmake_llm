/**
 * reportdata 결정적 렌더 주입 테스트 — fence 감지·fail-open·본문 정리 계약.
 */
import { tryRenderReportBlock } from '../report-block';

const VALID_DATA = {
    template: 'generic-report',
    data: {
        KICKER: 'TEST',
        REPORT_TITLE: '테스트 보고서',
        SUBTITLE: 's',
        TOPLINE: 't',
        SUMMARY: 'sum',
        sections: [{ heading: 'h', paragraphs: ['p'] }],
        sources: [{ title: 'src', url: 'https://example.com' }],
    },
};

function fence(json: string): string {
    return '```reportdata\n' + json + '\n```';
}

describe('tryRenderReportBlock', () => {
    it('유효한 reportdata — 아티팩트 append 생성 + 원문 fence 제거', () => {
        const content = `조사 결과를 정리했습니다.\n\n${fence(JSON.stringify(VALID_DATA))}\n\n이상입니다.`;
        const r = tryRenderReportBlock(content);
        expect(r).not.toBeNull();
        expect(r!.title).toBe('테스트 보고서');
        expect(r!.artifactAppend).toMatch(/<artifact id="report-[a-z0-9]+" kind="html" title="테스트 보고서">/);
        expect(r!.artifactAppend).toContain('generic-report-v1-open-design');
        expect(r!.content).not.toContain('```reportdata');
        expect(r!.content).toContain('조사 결과를 정리했습니다.');
        expect(r!.content).toContain('이상입니다.');
    });

    it('래퍼 없이 data 를 직접 출력한 경우도 수용', () => {
        const r = tryRenderReportBlock(fence(JSON.stringify(VALID_DATA.data)));
        expect(r).not.toBeNull();
        expect(r!.title).toBe('테스트 보고서');
    });

    it('fence 없음 → null (일반 응답 무영향)', () => {
        expect(tryRenderReportBlock('그냥 일반 답변입니다.')).toBeNull();
    });

    it('잘못된 JSON → null (fail-open)', () => {
        expect(tryRenderReportBlock(fence('{ broken json,, }'))).toBeNull();
    });

    it('닫히지 않은 fence(스트림 절단) → null', () => {
        expect(tryRenderReportBlock('```reportdata\n{"a":1}')).toBeNull();
    });

    it('알 수 없는 template 은 기본 템플릿으로 렌더', () => {
        const payload = { ...VALID_DATA, template: 'no-such-template' };
        const r = tryRenderReportBlock(fence(JSON.stringify(payload)));
        expect(r).not.toBeNull();
        expect(r!.artifactAppend).toContain('generic-report-v1-open-design');
    });

    it('제목의 큰따옴표는 작은따옴표로 강등 (artifact 속성 파서 보호)', () => {
        const payload = {
            ...VALID_DATA,
            data: { ...VALID_DATA.data, REPORT_TITLE: '그는 "혁신"이라 했다' },
        };
        const r = tryRenderReportBlock(fence(JSON.stringify(payload)));
        expect(r).not.toBeNull();
        expect(r!.artifactAppend).toContain(`title="그는 '혁신'이라 했다"`);
    });
});
