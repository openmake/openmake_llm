/**
 * 보고서 결정적 렌더러 — 고정 디자인 템플릿에 LLM 데이터(JSON)만 치환.
 *
 * infra/task-runtime/report-template/render_report.py 의 TS 이식(채팅 경로용).
 * 동일 계약: {{TOKEN}} 스칼라 치환 + <!-- REPEAT:NAME --> 반복 블록. 디자인은 절대
 * 바뀌지 않고, LLM 문자열은 전부 escape 되어 마크업으로 해석되지 않는다(아티팩트
 * iframe·공유 뷰어로 서빙되는 산출물).
 *
 * py 렌더러와의 차이: 반복 그룹이 region 필터가 아니라 레지스트리
 * (config/report-templates.ts) 의 kind(flat/section/source)로 렌더된다 —
 * section 은 paragraphs/bullets/table/chart 를 렌더러가 안전 HTML 로 조립한다.
 *
 * @module services/report/report-renderer
 */
import fs from 'fs';
import path from 'path';
import {
    REPORT_TEMPLATES,
    REPORT_TEMPLATES_DIR,
    type ReportTemplateGroupSpec,
} from '../../config/report-templates';

const TOKEN_RE = /\{\{([A-Z0-9_]+)\}\}/g;
const REPEAT_RE = /[ \t]*<!-- REPEAT:([A-Z0-9_]+) -->\n?([\s\S]*?)[ \t]*<!-- \/REPEAT -->\n?/g;
/** 표 행 상한 — 아티팩트 비대·레이아웃 붕괴 방지 (초과분은 경고와 함께 절단). */
const TABLE_MAX_ROWS = 50;
/** 차트 항목 상한 — 막대/라인 모두 이 개수까지만 렌더. */
const CHART_MAX_ITEMS = 24;

export interface RenderReportResult {
    html: string;
    /** 렌더는 성공했지만 데이터 품질 문제(누락 키·버려진 키 등) 관측용 경고 */
    warnings: string[];
    /** 아티팩트 제목으로 쓸 값 (REPORT_TITLE 우선) */
    title: string;
}

/** 템플릿 파일 캐시 — 배포 단위로 정적이므로 프로세스 수명 캐시. */
const templateCache = new Map<string, string>();

function loadTemplate(templateId: string): string {
    const spec = REPORT_TEMPLATES[templateId];
    if (!spec) throw new Error(`알 수 없는 보고서 템플릿: ${templateId}`);
    const cached = templateCache.get(templateId);
    if (cached) return cached;
    const filePath = path.join(REPORT_TEMPLATES_DIR, spec.file);
    const tpl = fs.readFileSync(filePath, 'utf-8');
    templateCache.set(templateId, tpl);
    return tpl;
}

function esc(v: unknown): string {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** LLM 이 아니라 렌더러가 결정하는 값 — 실행일 날짜(리포트 기준 TZ). */
function computed(now: Date): Record<string, string> {
    const runDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: process.env.REPORT_TZ || 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    return { RUN_DATE: runDate };
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 유한 숫자 배열로 정제 — 숫자가 아닌 항목은 대응 라벨과 함께 제외. */
function numericSeries(labels: unknown[], values: unknown[]): Array<{ label: string; value: number }> {
    const out: Array<{ label: string; value: number }> = [];
    for (let i = 0; i < Math.min(labels.length, values.length, CHART_MAX_ITEMS); i++) {
        const n = Number(values[i]);
        if (Number.isFinite(n)) out.push({ label: String(labels[i] ?? ''), value: n });
    }
    return out;
}

/** 가로 막대 차트 — 값을 최대값 대비 %로 정규화한 track/fill (템플릿 CSS 재사용). */
function buildBarChart(series: Array<{ label: string; value: number }>, unit: string): string {
    const max = Math.max(...series.map((s) => Math.abs(s.value)), 1e-9);
    const lines = series.map((s) => {
        const pct = Math.max(0, Math.min(100, (Math.abs(s.value) / max) * 100)).toFixed(1);
        return `<div class="metric-line"><span class="name">${esc(s.label)}</span>`
            + `<span class="track"><span class="fill" style="width:${pct}%"></span></span>`
            + `<span class="score">${esc(s.value)}${esc(unit)}</span></div>`;
    });
    return lines.join('');
}

/** 라인 차트 — 순수 SVG polyline (JS·외부 자산 없음, CSP 무관). */
function buildLineChart(series: Array<{ label: string; value: number }>, unit: string): string {
    const W = 560; const H = 140; const PAD_X = 8; const PAD_Y = 14;
    const min = Math.min(...series.map((s) => s.value));
    const max = Math.max(...series.map((s) => s.value));
    const span = max - min || 1;
    const stepX = series.length > 1 ? (W - PAD_X * 2) / (series.length - 1) : 0;
    const pts = series.map((s, i) => {
        const x = PAD_X + stepX * i;
        const y = H - PAD_Y - ((s.value - min) / span) * (H - PAD_Y * 2);
        return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    });
    const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const dots = pts.map((p) => `<circle class="pt" cx="${p.x}" cy="${p.y}" r="2.6"></circle>`).join('');
    const first = series[0]; const last = series[series.length - 1];
    return `<svg class="linechart" viewBox="0 0 ${W} ${H}" role="img">`
        + `<line class="base" x1="0" y1="${H - PAD_Y}" x2="${W}" y2="${H - PAD_Y}"></line>`
        + `<polyline points="${polyline}"></polyline>${dots}`
        + `<text x="${PAD_X}" y="${H - 2}">${esc(first.label)}</text>`
        + `<text x="${W - PAD_X}" y="${H - 2}" text-anchor="end">${esc(last.label)}</text>`
        + `<text x="${W - PAD_X}" y="10" text-anchor="end">max ${esc(max)}${esc(unit)}</text>`
        + `</svg>`;
}

function buildTable(table: Record<string, unknown>, warnings: string[]): string {
    const headers = Array.isArray(table.headers) ? table.headers : [];
    let rows = Array.isArray(table.rows) ? table.rows : [];
    if (rows.length > TABLE_MAX_ROWS) {
        warnings.push(`표 행 ${rows.length}개 중 ${TABLE_MAX_ROWS}개만 렌더(상한 절단)`);
        rows = rows.slice(0, TABLE_MAX_ROWS);
    }
    const thead = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
    const tbody = rows
        .map((r) => `<tr>${(Array.isArray(r) ? r : [r]).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('');
    return `<div class="table-wrap"><table>${thead}<tbody>${tbody}</tbody></table></div>`;
}

function buildChart(chart: Record<string, unknown>, warnings: string[]): string {
    const labels = Array.isArray(chart.labels) ? chart.labels : [];
    const values = Array.isArray(chart.values) ? chart.values : [];
    const series = numericSeries(labels, values);
    if (series.length === 0) {
        warnings.push('차트 데이터가 비었거나 숫자가 아니어서 생략');
        return '';
    }
    const unit = typeof chart.unit === 'string' ? chart.unit : '';
    const title = typeof chart.title === 'string' && chart.title
        ? `<div class="chart-title">${esc(chart.title)}</div>` : '';
    const body = chart.type === 'line' && series.length >= 2
        ? buildLineChart(series, unit)
        : buildBarChart(series, unit);
    return `<div class="chart">${title}${body}</div>`;
}

/** 섹션 본문 조립 — LLM 은 구조화 데이터만 주고, HTML 은 전부 여기서 만든다. */
function buildSectionBody(item: Record<string, unknown>, warnings: string[]): string {
    const parts: string[] = [];
    if (Array.isArray(item.paragraphs)) {
        for (const p of item.paragraphs) parts.push(`<p>${esc(p)}</p>`);
    }
    if (Array.isArray(item.bullets) && item.bullets.length > 0) {
        parts.push(`<ul>${item.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
    }
    if (isRecord(item.table)) parts.push(buildTable(item.table, warnings));
    if (isRecord(item.chart)) parts.push(buildChart(item.chart, warnings));
    if (parts.length === 0) warnings.push(`섹션 "${String(item.heading ?? '?')}" 본문이 비어 있음`);
    return parts.join('');
}

/** 출처 링크 — http(s) URL 만 anchor 로, 그 외는 텍스트로 강등(스킴 주입 차단). */
function buildSourceLink(item: Record<string, unknown>): string {
    const title = esc(item.title || item.url || '—');
    const url = String(item.url ?? '');
    if (/^https?:\/\//i.test(url)) {
        return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`;
    }
    return title;
}

/** 반복 그룹의 항목 1개 → {{ITEM_*}} 치환 필드 맵 (값은 이미 안전 HTML). */
function itemFields(
    spec: ReportTemplateGroupSpec,
    item: Record<string, unknown>,
    index: number,
    warnings: string[],
): Record<string, string> {
    if (spec.kind === 'section') {
        return {
            ITEM_KICKER: esc(item.kicker ?? `Section ${index + 1}`),
            ITEM_HEADING: esc(item.heading ?? '—'),
            ITEM_BODY: buildSectionBody(item, warnings),
        };
    }
    if (spec.kind === 'source') {
        return {
            ITEM_NUM: String(index + 1).padStart(2, '0'),
            ITEM_LINK: buildSourceLink(item),
        };
    }
    // flat — 항목의 모든 스칼라 필드를 escape. deltaclass 류 class 주입은 whitelist.
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(item)) {
        if (v === null || typeof v === 'object') continue;
        out[`ITEM_${k.toUpperCase()}`] = k.toLowerCase() === 'deltaclass'
            ? (['up', 'down', 'steady'].includes(String(v)) ? String(v) : 'steady')
            : esc(v);
    }
    return out;
}

function renderGroup(
    spec: ReportTemplateGroupSpec,
    block: string,
    items: unknown[],
    warnings: string[],
): string {
    if (items.length === 0) return spec.emptyHtml ?? '';
    const out: string[] = [];
    items.forEach((raw, i) => {
        const item = isRecord(raw) ? raw : {};
        const fields = itemFields(spec, item, i, warnings);
        out.push(block.replace(TOKEN_RE, (m, tok: string) => {
            if (!tok.startsWith('ITEM_')) return m; // 스칼라 토큰은 그룹 밖 단계에서 치환
            if (tok in fields) return fields[tok];
            warnings.push(`반복 블록 토큰 ${tok} 에 대응하는 항목 필드 없음(—로 채움)`);
            return '—';
        }));
    });
    return out.join('');
}

/**
 * 보고서 렌더 — 실패는 throw (호출부가 fail-open 처리).
 */
export function renderReport(
    templateId: string,
    data: Record<string, unknown>,
    now: Date = new Date(),
): RenderReportResult {
    const spec = REPORT_TEMPLATES[templateId];
    if (!spec) throw new Error(`알 수 없는 보고서 템플릿: ${templateId}`);
    const tpl = loadTemplate(templateId);
    const warnings: string[] = [];

    // 1) 반복 블록 렌더
    const usedGroupSources = new Set<string>();
    let html = tpl.replace(REPEAT_RE, (_whole, name: string, block: string) => {
        const groupSpec = spec.groups[name];
        if (!groupSpec) {
            warnings.push(`레지스트리에 없는 반복 그룹 ${name} — 블록 제거`);
            return '';
        }
        usedGroupSources.add(groupSpec.source);
        const items = Array.isArray(data[groupSpec.source]) ? data[groupSpec.source] as unknown[] : [];
        return renderGroup(groupSpec, block, items, warnings);
    });

    // 2) 스칼라 토큰 치환 (누락 키는 — 로 채우고 경고 — py 렌더러와 동일 계약)
    const auto = computed(now);
    const missing: string[] = [];
    html = html.replace(TOKEN_RE, (_m, tok: string) => {
        if (tok in auto) return auto[tok];
        const v = data[tok];
        if (v === undefined || v === null || typeof v === 'object') {
            missing.push(tok);
            return '—';
        }
        let raw = String(v);
        const cap = spec.maxLen?.[tok];
        if (cap && raw.length > cap) {
            warnings.push(`${tok} 가 ${cap}자를 초과해 잘림(${raw.length}자)`);
            raw = `${raw.slice(0, cap - 1)}…`;
        }
        return esc(raw);
    });
    if (missing.length > 0) warnings.push(`data 미제공 키(—로 채움): ${[...new Set(missing)].join(', ')}`);

    // 3) 역방향 검사 — 템플릿이 쓰지 않아 조용히 버려지는 데이터 표면화 (py 렌더러 계약).
    const scalarTokens = new Set<string>();
    for (const m of tpl.replace(REPEAT_RE, '').matchAll(TOKEN_RE)) scalarTokens.add(m[1]);
    const unused = Object.keys(data).filter((k) => !scalarTokens.has(k) && !usedGroupSources.has(k));
    if (unused.length > 0) warnings.push(`템플릿이 사용하지 않아 버려진 키: ${unused.join(', ')}`);

    const title = typeof data.REPORT_TITLE === 'string' && data.REPORT_TITLE.trim()
        ? data.REPORT_TITLE.trim()
        : '보고서';
    return { html, warnings, title };
}
