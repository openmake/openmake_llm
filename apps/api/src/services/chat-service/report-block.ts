/**
 * 보고서 결정적 렌더 주입 — external-provider 응답 조립부에서 호출 (파일 크기 가드 분리).
 *
 * 모델이 출력한 ```reportdata JSON 블록을 감지해 고정 디자인 템플릿으로 렌더하고,
 * 렌더 결과를 <artifact kind="html"> 블록으로 반환한다. 호출부가 이를 onToken(라이브
 * 스트림 — ws ArtifactStreamParser 가 artifact 이벤트로 발행)과 반환 본문(저장 히스토리 —
 * request-handler 의 extractAndStripArtifacts 가 영속화) 양쪽에 덧붙인다. 카카오맵 블록·
 * 웹검색 출처와 동일한 결정적 첨부 패턴.
 *
 * 원문 reportdata 블록은 본문에서 제거한다 — 남겨두면 ① 다음 턴 프롬프트에 대형 JSON 이
 * 재주입되고 ② artifact-parser 의 fence-fallback(≥15줄)이 원본 JSON 을 code 아티팩트로
 * 중복 생성한다.
 *
 * 실패는 전부 fail-open(null 반환) — 렌더 불가 시 응답은 현행 그대로 나간다.
 *
 * @module services/chat-service/report-block
 */
import { renderReport } from '../report/report-renderer';
import { REPORT_TEMPLATES } from '../../config/report-templates';
import { REPORT_PIPELINE } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ChatReportBlock');

const REPORTDATA_FENCE_RE = /```reportdata\s*\n([\s\S]*?)```/;
const DEFAULT_TEMPLATE_ID = 'generic-report';

export interface ReportBlockResult {
    /** reportdata 블록이 제거된 본문 (저장 히스토리용) */
    content: string;
    /** 라이브 스트림 + 히스토리에 덧붙일 <artifact> 블록 */
    artifactAppend: string;
    title: string;
}

/**
 * 렌더된 보고서 아티팩트의 reportdata 원본 대기열 — artifact 영속화 시점
 * (request-handler insertArtifact)에 takeReportSource 로 회수해 source_data 로 저장한다.
 * 렌더와 영속화가 같은 요청 흐름이라 프로세스-로컬 Map 으로 충분. 영속화가 실패해도
 * 누수되지 않게 상한을 두고 오래된 항목부터 버린다.
 */
const pendingReportSources = new Map<string, Record<string, unknown>>();
const PENDING_SOURCES_MAX = 50;

function rememberReportSource(artifactId: string, source: Record<string, unknown>): void {
    if (pendingReportSources.size >= PENDING_SOURCES_MAX) {
        const oldest = pendingReportSources.keys().next().value;
        if (oldest) pendingReportSources.delete(oldest);
    }
    pendingReportSources.set(artifactId, source);
}

/** 아티팩트 id 의 reportdata 원본을 회수(1회성). 보고서 아티팩트가 아니면 null. */
export function takeReportSource(artifactId: string): Record<string, unknown> | null {
    const v = pendingReportSources.get(artifactId) ?? null;
    if (v) pendingReportSources.delete(artifactId);
    return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 원문 문자열에 reportdata 렌더를 적용해 <artifact> 가 포함된 본문으로 변환.
 *
 * Agent Task 완료 경로용 — 이후의 extractAndStripArtifacts 가 아티팩트를 추출·영속화한다.
 * 렌더하지 않으면 fence-fallback(≥15줄)이 원본 JSON 을 code 아티팩트로 잘못 영속화하므로,
 * 반드시 추출 **전에** 호출해야 한다. 플래그 OFF·블록 없음·렌더 실패면 원문 그대로 반환.
 */
export function applyReportRender(raw: string): string {
    if (!REPORT_PIPELINE.ENABLED || !raw) return raw;
    const r = tryRenderReportBlock(raw);
    return r ? r.content + r.artifactAppend : raw;
}

/**
 * 응답 본문의 reportdata 블록을 렌더해 아티팩트 append 로 변환.
 * 블록이 없거나 렌더 불가면 null (호출부는 아무것도 하지 않는다).
 */
export function tryRenderReportBlock(finalContent: string): ReportBlockResult | null {
    const m = REPORTDATA_FENCE_RE.exec(finalContent);
    if (!m) return null;
    try {
        const parsed: unknown = JSON.parse(m[1]);
        if (!isRecord(parsed)) {
            logger.warn('[Report] reportdata JSON 이 객체가 아님 — 렌더 생략');
            return null;
        }
        // 계약: { template, data:{...} }. 모델이 래퍼 없이 data 를 직접 출력한 경우도 수용.
        const templateId = typeof parsed.template === 'string' && parsed.template in REPORT_TEMPLATES
            ? parsed.template
            : DEFAULT_TEMPLATE_ID;
        const data = isRecord(parsed.data) ? parsed.data : parsed;

        const { html, warnings, title } = renderReport(templateId, data);
        if (warnings.length > 0) {
            logger.warn(`[Report] 렌더 경고(${templateId}): ${warnings.join(' | ')}`);
        }

        // 아티팩트 시작 태그 속성은 "..." 파싱 — 제목의 큰따옴표는 작은따옴표로 강등.
        const safeTitle = title.replace(/"/g, "'").slice(0, 200);
        const artifactId = `report-${Date.now().toString(36)}`;
        // reportdata 원본 보존 — 영속화 시점에 source_data 로 저장(docx 등 구조 기반 export 용).
        rememberReportSource(artifactId, { template: templateId, data });
        const artifactAppend = `\n\n<artifact id="${artifactId}" kind="html" title="${safeTitle}">\n${html}\n</artifact>`;

        // 원문 블록 제거 (첫 블록만 — 계약상 1개). 제거로 생긴 3연속 개행은 정리.
        const content = finalContent.replace(REPORTDATA_FENCE_RE, '').replace(/\n{3,}/g, '\n\n');

        logger.info(`[Report] reportdata 렌더 완료: template=${templateId} title="${safeTitle}" bytes=${html.length} warnings=${warnings.length}`);
        return { content, artifactAppend, title };
    } catch (e) {
        logger.warn(`[Report] reportdata 렌더 실패 (fail-open — 원문 유지): ${e instanceof Error ? e.message : e}`);
        return null;
    }
}
