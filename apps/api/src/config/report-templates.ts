/**
 * 보고서 템플릿 레지스트리 (L2 config) — 채팅 보고서 파이프라인의 템플릿 카탈로그.
 *
 * 디자인(HTML/CSS)은 data/report-templates/ 의 고정 템플릿이 담당하고, LLM 은
 * ```reportdata 블록으로 데이터(JSON)만 생성한다 — 예약 리포트(render_report.py)와
 * 동일한 "renderer owns design" 계약의 채팅 경로 버전.
 *
 * 새 템플릿 추가 시: ① src/report-templates/ 에 HTML 작성 ② 여기 스펙 등록
 * ③ contract 에 LLM 에게 보여줄 데이터 계약을 기술.
 *
 * @module config/report-templates
 */
import path from 'path';

/** 반복 그룹(<!-- REPEAT:NAME -->) 렌더 방식. */
export type ReportGroupKind =
    /** 항목의 모든 스칼라 필드를 escape 해 {{ITEM_필드명}} 치환 */
    | 'flat'
    /** 섹션 항목 — 렌더러가 paragraphs/bullets/table/chart 로 ITEM_BODY 안전 HTML 을 조립 */
    | 'section'
    /** 출처 항목 — 렌더러가 번호·검증된 링크(ITEM_NUM/ITEM_LINK)를 조립 */
    | 'source';

export interface ReportTemplateGroupSpec {
    /** data 객체에서 이 그룹의 항목 배열이 담긴 키 (예: 'sections') */
    source: string;
    kind: ReportGroupKind;
    /** 항목 배열이 비었을 때 블록 대신 넣을 HTML (기본 '') */
    emptyHtml?: string;
}

export interface ReportTemplateSpec {
    /** 템플릿 파일명 (REPORT_TEMPLATES_DIR 기준 상대 경로) */
    file: string;
    /** REPEAT 그룹명 → 렌더 스펙 */
    groups: Record<string, ReportTemplateGroupSpec>;
    /** 값 길이 상한 — 레이아웃 보장용 데이터 단 절단 (렌더러가 초과분을 …로 자름) */
    maxLen?: Record<string, number>;
    /** LLM 에게 주입할 데이터 계약 설명 (report-guide 프롬프트에 그대로 포함) */
    contract: string;
}

/**
 * 템플릿 HTML 디렉토리 — 소스와 함께 버전관리되는 src/report-templates/ (빌드 시
 * copy-report-templates 로 dist/report-templates/ 에 복사 — copy-agent-data 선례).
 * __dirname 기준이라 src(ts-node 개발)·dist(운영) 모두 동일 상대 경로로 해석된다.
 * (레포 루트 /data/ 는 gitignore 된 런타임 데이터 영역이라 템플릿을 둘 수 없다.)
 */
export const REPORT_TEMPLATES_DIR = process.env.REPORT_TEMPLATES_DIR
    || path.resolve(__dirname, '../report-templates');

export const REPORT_TEMPLATES: Record<string, ReportTemplateSpec> = {
    'generic-report': {
        file: 'generic-report.html',
        groups: {
            KPIS: { source: 'kpis', kind: 'flat' },
            SECTIONS: { source: 'sections', kind: 'section' },
            SOURCES: {
                source: 'sources',
                kind: 'source',
                emptyHtml: '<div class="source-line"><span class="num">—</span><span>출처 미제공</span></div>',
            },
        },
        maxLen: { KICKER: 40 },
        contract: [
            '{',
            '  "template": "generic-report",',
            '  "data": {',
            '    "KICKER": "짧은 카테고리 라벨 (예: MARKET RESEARCH, 40자 이내)",',
            '    "REPORT_TITLE": "보고서 제목",',
            '    "SUBTITLE": "제목 아래 한두 문장 요지",',
            '    "TOPLINE": "조사 범위·방법 한 줄",',
            '    "SUMMARY": "핵심 요약 3~5문장",',
            '    "kpis": [ { "label": "지표명", "value": "값", "note": "부연", "delta": "+7%", "deltaclass": "up|down|steady" } ],',
            '    "sections": [ {',
            '      "kicker": "섹션 카테고리 라벨", "heading": "섹션 제목",',
            '      "paragraphs": ["본문 문단", "..."],',
            '      "bullets": ["요점", "..."],',
            '      "table": { "headers": ["열1", "열2"], "rows": [["값", "값"]] },',
            '      "chart": { "type": "bar|line", "title": "차트 제목", "labels": ["항목"], "values": [숫자], "unit": "%" }',
            '    } ],',
            '    "sources": [ { "title": "출처 제목", "url": "https://..." } ]',
            '  }',
            '}',
            '- kpis 는 0~4개. sections 는 2개 이상 필수 — paragraphs/bullets/table/chart 는 각 섹션에서 필요한 것만 포함.',
            '- 조사에 사용한 실제 출처를 sources 에 전부 담는다. 값은 전부 조사 근거 기반 — 지어내지 마라.',
        ].join('\n'),
    },
};
