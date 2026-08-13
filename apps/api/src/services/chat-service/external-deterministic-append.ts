/**
 * 외부 provider 응답의 결정적 첨부 후처리 — external-provider.ts 에서 분리 (600줄 CI 가드).
 *
 * 도구 루프 중 수집한 블록(생성 이미지·카카오 지도·토론 출처·웹검색 출처·보고서)을 최종
 * 응답 끝에 1회 붙인다. LLM(특히 qwen)이 도구 지시("마크다운 그대로 포함")나 인용 지시를
 * 자주 무시해 산출물/근거가 답변에 안 드러나던 문제를 결정적으로 보정한다. onToken =
 * 라이브 스트림, 반환값 = 저장 히스토리 — 양쪽에 반영해 reload 후에도 유지.
 *
 * @module services/chat-service/external-deterministic-append
 */
import { createLogger } from '../../utils/logger';
import { REPORT_PIPELINE } from '../../config/runtime-limits';
import { tryRenderReportBlock } from './report-block';
import { basename } from 'path';
import { MCP_NAMESPACE_SEPARATOR } from '../../mcp/types';
import { MCP_META_TOOL_NAMES } from '../../mcp/mcp-meta-tools';

const MCP_CALL_TOOL_NAME = MCP_META_TOOL_NAMES[1]; // 'mcp_call'
import { WEB_SEARCH_TEMPLATES, getLocalizedTemplate } from '../../sockets/ws-chat-locales';
import type { ChatMessageRequest } from '../chat-service-types';
import type { StreamFromExternalContext } from './external-provider';

const logger = createLogger('ChatExternalProvider');

export interface DeterministicAppendInput {
    /** 모델이 만든 최종 본문 (이미 라이브 스트리밍된 텍스트). */
    finalContent: string;
    /** 라이브 스트림 콜백 — 첨부분을 프론트에 밀어낸다. */
    onToken: (token: string, thinking?: string) => void;
    /** generate_image 결과의 이미지 마크다운. */
    generatedImageMarkdowns: string[];
    /** search-places 도구가 동봉한 ```kakaomap 블록. */
    kakaomapBlocks: string[];
    /** start_discussion 출처 블록. */
    discussionSourceBlocks: string[];
    /** 오픈디자인 도구로 저장한 HTML 산출물 (마지막 저장본 — captureOdArtifactHtml 참고). */
    odArtifact?: OdArtifactCapture | null;
    req: ChatMessageRequest;
    ctx: StreamFromExternalContext;
}

/** open-design 도구 인자에서 캡처한 HTML 산출물. */
export interface OdArtifactCapture {
    id: string;
    title: string;
    html: string;
}

/**
 * mcp_call 메타 도구 경유 간접 호출을 실제 도구 호출로 정규화한다.
 * mcp_call(server, tool, args) → { name: "server::tool", args } — 직접 호출은 그대로 반환.
 * (진행적 공개 경로로 open-design 을 부르면 tc.name 이 'mcp_call' 이라 캡처를 놓치는 갭 보정.)
 */
export function normalizeOdToolCall(
    name: string,
    args: Record<string, unknown>,
): { name: string; args: Record<string, unknown> } {
    if (name !== MCP_CALL_TOOL_NAME) return { name, args };
    const inner = args.args && typeof args.args === 'object'
        ? args.args as Record<string, unknown> : {};
    return {
        name: `${String(args.server ?? '')}${MCP_NAMESPACE_SEPARATOR}${String(args.tool ?? '')}`,
        args: inner,
    };
}

/**
 * open-design create_artifact/write_file 호출 인자에서 자체완결 HTML 을 캡처한다.
 * CSS/JSX 등 부속 파일이나 실패한 호출은 null — 호출부는 마지막 캡처만 유지한다(수정본 우선).
 */
export function captureOdArtifactHtml(
    args: Record<string, unknown>,
    toolResult: string,
): OdArtifactCapture | null {
    if (toolResult.startsWith('Error')) return null;
    const content = typeof args.content === 'string' ? args.content : '';
    const head = content.trimStart().slice(0, 15).toLowerCase();
    if (!head.startsWith('<!doctype') && !head.startsWith('<html')) return null;
    const fileName = typeof args.name === 'string' ? args.name
        : typeof args.path === 'string' ? args.path : '';
    const base = basename(fileName).replace(/\.[a-z0-9]+$/i, '') || 'design';
    const titleTag = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(content)?.[1]?.trim();
    // 아티팩트 시작 태그 속성은 "..." 파싱 — 제목의 큰따옴표는 작은따옴표로 강등(report-block 동일).
    const title = (titleTag || base).replace(/"/g, "'").slice(0, 200);
    const id = `${base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design'}-${Date.now().toString(36)}`;
    return { id, title, html: content };
}

/**
 * 수집된 블록을 최종 응답에 결정적으로 첨부하고 갱신된 본문을 반환한다.
 */
export function appendDeterministicBlocks(input: DeterministicAppendInput): string {
    const { onToken, generatedImageMarkdowns, kakaomapBlocks, discussionSourceBlocks, req, ctx } = input;
    let finalContent = input.finalContent;

    // generate_image 가 성공했으나 LLM 이 최종 응답에 이미지 마크다운을 누락한 경우 결정적 첨부.
    // (qwen 등 로컬 모델이 도구 지시를 따르지 않아 생성 이미지가 채팅에 표시 안 되던 문제 보정.
    //  onToken = 라이브 스트림, 반환값 = 저장 히스토리 — 양쪽에 반영해 reload 후에도 유지.)
    const missingImages = generatedImageMarkdowns.filter((md) => {
        const pathMatch = md.match(/\(([^)]+)\)/);
        return !pathMatch || !finalContent.includes(pathMatch[1]);
    });
    if (missingImages.length > 0) {
        const appended = (finalContent.trim() ? '\n\n' : '') + missingImages.join('\n\n');
        onToken(appended, undefined);
        finalContent += appended;
        logger.info(`🖼️ 생성 이미지 ${missingImages.length}개 자동 첨부 (LLM 응답 누락 보정)`);
    }

    // 카카오 지도 블록도 동일하게 — LLM 이 옮기지 않았으면 결정적 첨부(라이브 stream + 저장 히스토리).
    const missingMaps = kakaomapBlocks.filter((b) => !finalContent.includes(b));
    if (missingMaps.length > 0) {
        const appended = (finalContent.trim() ? '\n\n' : '') + missingMaps.join('\n\n');
        onToken(appended, undefined);
        finalContent += appended;
        logger.info(`🗺️ 카카오 지도 블록 ${missingMaps.length}개 자동 첨부 (LLM 응답 누락 보정)`);
    }

    // 토론 출처 목록 결정적 첨부 — 도구 결과에 실려 온 블록을 모델이 옮기지 않으므로
    // (요약 과정에서 유실) 최종 응답에 1회 붙인다. URL 이 이미 본문에 있으면 건너뛴다.
    const missingSources = discussionSourceBlocks.filter((b) => !finalContent.includes(b));
    if (missingSources.length > 0) {
        const appended = (finalContent.trim() ? '\n\n' : '') + missingSources.join('\n\n');
        onToken(appended, undefined);
        finalContent += appended;
        logger.info(`🔗 토론 출처 ${missingSources.length}블록 자동 첨부 (LLM 요약 누락 보정)`);
    }

    // 웹검색 출처 목록 결정적 첨부 (서버 canonical 출처, 2026-08-14 강화) — 출처 목록의
    // 정합성을 모델(qwen) 재량에 맡기지 않는다. 프롬프트는 "[출처 N] 인라인 마커만, 목록 작성
    // 금지"로 지시하고(ws-chat-locales), 목록은 서버가 실제 수집한 (번호→제목·URL) 매핑으로
    // 생성한다. 모델이 지시를 무시하고 목록을 만들었으면(비순응 상습) 인용 번호별 URL 존재를
    // 검증해 누락분만 보강 — 인용 [출처 3]·[출처 8]이 목록에서 빠지던 라이브 결함의 재발 차단.
    // (이미 스트리밍된 본문은 수정 불가 → 모든 교정은 append-only.)
    // 소스 문자열은 message-pipeline 경로에선 req.webSearchContext 가 아니라 ctx.enhancedMessage
    // (finalEnhancedMessage, context-builder 가 웹검색 컨텍스트를 합친 값)에 실려 온다. 둘 다 fallback.
    const webSearchCtxText = req.webSearchContext || ctx.enhancedMessage || '';
    if (/\[[^\]]*?\d+\]\s*.+?\n\s*URL:\s*\S+/.test(webSearchCtxText)) {
        const srcLang = ctx.resolvedLanguage || req.userLanguagePreference || 'en';
        const srcLabel = getLocalizedTemplate(WEB_SEARCH_TEMPLATES, srcLang).sourceLabel;
        const headerRe = new RegExp(`(^|\\n)\\s*(#{1,3}\\s*|\\*\\*\\s*)${srcLabel}`);
        const headerIdx = finalContent.search(headerRe);
        const alreadyHasSources = headerIdx >= 0;
        // 컨텍스트에서 번호→(제목, URL) 파싱 — canonical 목록 생성·누락 검증에 공용.
        const numToSource = new Map<string, { title: string; url: string }>();
        const re = /\[[^\]]*?(\d+)\]\s*(.+?)\n\s*URL:\s*(\S+)/g;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(webSearchCtxText)) !== null) {
            if (!numToSource.has(mm[1])) {
                numToSource.set(mm[1], { title: mm[2].trim(), url: mm[3].trim() });
            }
        }
        // 본문에 인용된 소스 번호 ([출처 N]/[Source N]/[N] — 수집 목록에 있는 번호만 인정)
        const citedNums: string[] = [];
        const citeRe = /\[[^\]\n]*?(\d+)\]/g;
        let cm: RegExpExecArray | null;
        while ((cm = citeRe.exec(finalContent)) !== null) {
            if (numToSource.has(cm[1]) && !citedNums.includes(cm[1])) citedNums.push(cm[1]);
        }
        if (!alreadyHasSources) {
            // canonical 목록 첨부 — 인용된 번호가 있으면 그 소스만(정밀), 없으면 전체(기존 동작).
            // 번호는 인라인 인용과 일치하도록 원본 소스 번호를 유지한다 (재번호 시 [출처 3]↔목록 불일치).
            const targetNums = citedNums.length > 0 ? citedNums : [...numToSource.keys()];
            const entries: string[] = [];
            const seen = new Set<string>();
            for (const n of targetNums) {
                const { title, url } = numToSource.get(n)!;
                if (url && !seen.has(url)) {
                    seen.add(url);
                    entries.push(`${n}. [${title || url}](${url})`);
                }
            }
            if (entries.length > 0) {
                const block = `\n\n---\n\n**${srcLabel}**\n${entries.join('\n')}`;
                onToken(block, undefined);
                finalContent += block;
                logger.info(`🔗 웹검색 출처 ${entries.length}개 자동 첨부 (서버 canonical${citedNums.length > 0 ? ', 인용 기반' : ''})`);
            }
        } else {
            // 모델이 목록 작성 금지 지시를 무시하고 섹션을 만든 경우 — 인용 번호별로 해당
            // 소스 URL 이 본문 어딘가에 존재하는지 검증, 누락분만 보강. 인용이 전혀 없는데
            // 섹션에 URL 도 없으면(제목만 나열) 전체 번호 보강 (기존 동작 유지).
            const missingNums = citedNums.filter((n) => !finalContent.includes(numToSource.get(n)!.url));
            const nums = missingNums.length > 0
                ? missingNums
                : citedNums.length === 0 && !/https?:\/\//.test(finalContent.slice(headerIdx))
                    ? [...numToSource.keys()]
                    : [];
            const lines = nums.map((n) => `[${n}] ${numToSource.get(n)!.url}`);
            if (lines.length > 0) {
                const block = `\n\n🔗 **URL**\n${lines.join('\n')}`;
                onToken(block, undefined);
                finalContent += block;
                logger.info(`🔗 출처 링크 ${lines.length}개 보강 (모델 출처 섹션 누락 검증)`);
            }
        }
    }

    // 오픈디자인 산출물 결정적 첨부 — create_artifact 로 워크스페이스에 저장한 HTML 덱을
    // 모델이 최종 응답 <artifact> 로 옮기지 않으면(말로만 안내, 2026-08-14 라이브 실측) 서버가
    // 1회 첨부한다. 모델이 이미 html 아티팩트를 출력했으면 중복 첨부하지 않는다.
    if (input.odArtifact && !/<artifact\b[^>]*kind="html"/.test(finalContent)) {
        const a = input.odArtifact;
        const block = `\n\n<artifact id="${a.id}" kind="html" title="${a.title}">\n${a.html}\n</artifact>`;
        onToken(block, undefined);
        finalContent += block;
        logger.info(`🎨 오픈디자인 아티팩트 결정적 첨부: "${a.title}" (${a.html.length}B)`);
    }

    // 보고서 결정적 렌더 (P1 파이프라인) — 모델이 출력한 ```reportdata JSON 블록을 고정
    // 템플릿으로 렌더해 <artifact> 로 첨부한다(카카오맵·출처와 동일한 결정적 첨부 패턴).
    // 원문 JSON 블록은 히스토리에서 제거 — 라이브 스트림에 이미 나간 블록은 프론트가 접는다.
    if (REPORT_PIPELINE.ENABLED) {
        const report = tryRenderReportBlock(finalContent);
        if (report) {
            onToken(report.artifactAppend, undefined);
            finalContent = report.content + report.artifactAppend;
            logger.info(`📊 보고서 아티팩트 결정적 첨부: "${report.title}"`);
        }
    }

    return finalContent;
}
