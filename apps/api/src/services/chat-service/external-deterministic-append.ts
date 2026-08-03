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
    req: ChatMessageRequest;
    ctx: StreamFromExternalContext;
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

    // 웹검색 출처 목록 결정적 첨부 — LLM(qwen)이 프롬프트의 인용 지시를 자주 무시해 근거 소스가
    // 답변에 안 드러나던 문제 보정. req.webSearchContext(formatSearchSources 포맷)에서 제목·URL 을
    // 파싱해 응답 끝에 출처 목록을 붙인다(카카오맵 블록과 동일한 결정적 첨부 패턴, 라이브 stream +
    // 저장 히스토리 양쪽 반영). 모델이 이미 출처 섹션(헤더)을 만든 경우엔 중복 방지로 skip.
    // 소스 문자열은 message-pipeline 경로에선 req.webSearchContext 가 아니라 ctx.enhancedMessage
    // (finalEnhancedMessage, context-builder 가 웹검색 컨텍스트를 합친 값)에 실려 온다. 둘 다 fallback.
    const webSearchCtxText = req.webSearchContext || ctx.enhancedMessage || '';
    if (/\[[^\]]*?\d+\]\s*.+?\n\s*URL:\s*\S+/.test(webSearchCtxText)) {
        const srcLang = ctx.resolvedLanguage || req.userLanguagePreference || 'en';
        const srcLabel = getLocalizedTemplate(WEB_SEARCH_TEMPLATES, srcLang).sourceLabel;
        const headerRe = new RegExp(`(^|\\n)\\s*(#{1,3}\\s*|\\*\\*\\s*)${srcLabel}`);
        const headerIdx = finalContent.search(headerRe);
        const alreadyHasSources = headerIdx >= 0;
        // 컨텍스트에서 번호→(제목, URL) 파싱 — 미첨부 시 전체 목록, 링크 누락 보강 시 번호 매칭에 공용.
        const numToSource = new Map<string, { title: string; url: string }>();
        const re = /\[[^\]]*?(\d+)\]\s*(.+?)\n\s*URL:\s*(\S+)/g;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(webSearchCtxText)) !== null) {
            if (!numToSource.has(mm[1])) {
                numToSource.set(mm[1], { title: mm[2].trim(), url: mm[3].trim() });
            }
        }
        if (!alreadyHasSources) {
            const entries: string[] = [];
            const seen = new Set<string>();
            for (const { title, url } of numToSource.values()) {
                if (url && !seen.has(url)) {
                    seen.add(url);
                    entries.push(`${entries.length + 1}. [${title || url}](${url})`);
                }
            }
            if (entries.length > 0) {
                const block = `\n\n---\n\n**${srcLabel}**\n${entries.join('\n')}`;
                onToken(block, undefined);
                finalContent += block;
                logger.info(`🔗 웹검색 출처 ${entries.length}개 자동 첨부 (LLM 인용 누락 보정)`);
            }
        } else if (!/https?:\/\//.test(finalContent.slice(headerIdx))) {
            // 모델이 출처 섹션을 직접 만들었지만 URL 없이 제목만 나열한 경우(자주 발생) —
            // 본문에 인용된 번호([출처 N] 등)를 컨텍스트의 URL 과 매칭해 클릭 가능한 링크
            // 블록을 덧붙인다. (이미 스트리밍된 본문은 수정 불가하므로 append-only)
            const citedNums: string[] = [];
            const citeRe = /\[[^\]\n]*?(\d+)\]/g;
            let cm: RegExpExecArray | null;
            while ((cm = citeRe.exec(finalContent)) !== null) {
                if (numToSource.has(cm[1]) && !citedNums.includes(cm[1])) citedNums.push(cm[1]);
            }
            const nums = citedNums.length > 0 ? citedNums : [...numToSource.keys()];
            const lines = nums.map((n) => {
                const s = numToSource.get(n)!;
                return `[${n}] ${s.url}`;
            });
            if (lines.length > 0) {
                const block = `\n\n🔗 **URL**\n${lines.join('\n')}`;
                onToken(block, undefined);
                finalContent += block;
                logger.info(`🔗 출처 링크 ${lines.length}개 보강 (모델 출처 섹션에 URL 누락)`);
            }
        }
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
