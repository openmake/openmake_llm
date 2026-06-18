/**
 * Deep Research - 보고서 생성 모듈
 *
 * 최종 리서치 보고서를 생성하는 기능을 제공합니다.
 *
 * @module services/deep-research/report-generator
 */

import { type LLMClient, createClient } from '../../llm';
import type { SearchResult } from '../../mcp/web-search';
import type { ResearchConfig, SubTopic } from '../deep-research-types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { TRUNCATION } from '../../config/runtime-limits';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import { deduplicateSources, extractBulletLikeFindings } from '../deep-research-utils';
import { SECTION_HEADERS, getReportPrompt, getResearchMessage } from '../deep-research-prompts';
import { verifyCitations } from './citation-verifier';
import { DEEP_RESEARCH_CITATION } from '../../config/runtime-limits';

const logger = createLogger('DeepResearch:ReportGenerator');

interface MarkdownSection {
    header: string;
    body: string;
}

/**
 * URL 에서 표시용 호스트명 추출 (www. 제거). 실패 시 빈 문자열.
 */
function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

/**
 * 참고문헌 블록을 코드로 생성 — `[N] [제목 (도메인)](url)` 마크다운 링크.
 *
 * LLM 에 raw URL 을 맡기면 Google News redirect 등 거대 base64 URL 이 그대로 노출되므로,
 * 본문(인용 [출처 N])과 번호가 일치하는 참고문헌을 코드로 단일 생성한다.
 *
 * @param sources 중복 제거된 소스 목록 (본문 인용 N 과 같은 순서)
 * @param refLabel 라벨 fallback 용 references 헤더 텍스트
 */
function buildReferencesBlock(sources: SearchResult[], refLabel: string): string {
    return sources
        .map((source, index) => {
            const domain = (source.source && source.source.trim()) || hostnameOf(source.url);
            const label = (source.title && source.title.trim()) || domain || `${refLabel} ${index + 1}`;
            // 도메인이 제목에 이미 포함돼 있으면 `(도메인)` 을 생략 — "제목 - 전자신문 (전자신문)" 중복 방지.
            const suffix = domain && !label.includes(domain) ? ` (${domain})` : '';
            return source.url
                ? `[${index + 1}] [${label}${suffix}](${source.url})`
                : `[${index + 1}] ${label}${suffix}`;
        })
        .join('\n');
}

/**
 * 마크다운을 ## 헤더 기준으로 분할 (regex 의존 제거)
 */
function splitMarkdownSections(content: string): MarkdownSection[] {
    const lines = content.split('\n');
    const sections: MarkdownSection[] = [];
    let currentHeader = '';
    let currentBody: string[] = [];

    for (const line of lines) {
        const headerMatch = line.match(/^##\s+(.+)/);
        if (headerMatch) {
            if (currentHeader) {
                sections.push({ header: currentHeader, body: currentBody.join('\n') });
            }
            currentHeader = headerMatch[1].trim();
            currentBody = [];
        } else {
            currentBody.push(line);
        }
    }
    if (currentHeader) {
        sections.push({ header: currentHeader, body: currentBody.join('\n') });
    }

    return sections;
}

/**
 * LLM 보고서 생성 실패 시 합성 결과 기반 fallback 보고서
 */
function buildFallbackReport(lang: string, topic: string, findings: string[], sourceList: string): string {
    const h = SECTION_HEADERS[lang] || SECTION_HEADERS['en']!;
    return [
        `# ${topic}`,
        '',
        `## ${h.summary}`,
        '',
        findings[0] || '',
        '',
        `## ${h.analysis}`,
        '',
        ...findings.slice(1).map((f, i) => `### ${i + 2}. 추가 분석\n\n${f}`),
        '',
        `## ${h.references}`,
        '',
        sourceList,
    ].join('\n');
}

/**
 * 최종 보고서 생성
 */
export async function generateReport(params: {
    client: LLMClient;
    config: ResearchConfig;
    topic: string;
    findings: string[];
    sources: SearchResult[];
    subTopics: SubTopic[];
    sessionId: string;
    /** 보고서 생성 진행 콜백 — 누적 생성 글자 수를 보고해 report 단계 progress 공백(체감 멈춤)을 제거 */
    onReportProgress?: (charsGenerated: number) => void;
    throwIfAborted: () => void;
}): Promise<{ summary: string; keyFindings: string[] }> {
    const { client, config, topic, findings, sources, subTopics, sessionId, onReportProgress, throwIfAborted } = params;

    throwIfAborted();
    const db = getUnifiedDatabase();
    const uniqueSources = deduplicateSources(sources);

    // 합성 결과가 모두 비어있거나 실패 메시지만 있으면 조기 반환
    const meaningfulFindings = findings.filter(f =>
        f && f.trim().length > 0
        && f !== getResearchMessage('synthesisFailed', config.language)
        && f !== getResearchMessage('noSources', config.language)
    );
    if (meaningfulFindings.length === 0) {
        logger.warn('[DeepResearch] 의미 있는 합성 결과 없음 — 보고서 생성 건너뜀');
        const fallbackSummary = getResearchMessage('reportFailed', config.language);
        await db.addResearchStep({
            sessionId,
            stepNumber: 999,
            stepType: 'report',
            query: '최종 보고서 생성 (건너뜀 — 합성 데이터 없음)',
            result: fallbackSummary,
            status: 'completed'
        });
        return { summary: fallbackSummary, keyFindings: [] };
    }

    const sourceList = uniqueSources
        .map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`)
        .join('\n');

    // 섹션 헤더 (본문 코드 참고문헌 재생성 + fallback 보고서 공용)
    const h = SECTION_HEADERS[config.language] || SECTION_HEADERS['en']!;

    const subTopicGuide = subTopics
        .map((subTopic, index) => `${index + 1}. ${subTopic.title}`)
        .join('\n');

    const prompt = getReportPrompt(config.language, topic, subTopicGuide, meaningfulFindings, sourceList);

    // 보고서 생성은 대형 프롬프트·장문 출력으로 전역 LLM_TIMEOUT(SDK)을 초과한다(라이브 검증 확인).
    // → 전용 긴 타임아웃 클라이언트 사용. (기존 reportController.signal 은 chat 에 전달되지 않아 무효였음)
    const reportClient = createClient({
        model: client.model,
        timeout: LLM_TIMEOUTS.REPORT_GENERATION_TIMEOUT_MS,
    });

    try {
        // 스트리밍 호출 — 토큰이 흐르는 동안 진행을 보고(85% 공백 해소)하고, 누적 출력으로
        // stall 여부를 가시화한다. onToken 모드에서도 client 는 최종 content 를 누적 반환한다.
        let accumulatedChars = 0;
        const response = await reportClient.chat(
            [{ role: 'user', content: prompt }],
            { temperature: LLM_TEMPERATURES.RESEARCH_SYNTHESIS },
            (token) => {
                accumulatedChars += token.length;
                onReportProgress?.(accumulatedChars);
            },
        );
        throwIfAborted();

        // LLM 이 생성한 참고문헌(## References) 섹션을 제거하고, 코드로 sources 를
        // 마크다운 링크 `[제목 (도메인)](url)` 로 재생성한다 — Google News 등 raw redirect URL 의
        // base64 노출을 방지하고, 본문 [출처 N] 인용과 번호를 일치시킨다.
        const rawContent = response.content;
        const refIdx = rawContent.indexOf(`## ${h.references}`);
        const reportBody = (refIdx >= 0 ? rawContent.slice(0, refIdx) : rawContent).trimEnd();
        const content = `${reportBody}\n\n## ${h.references}\n\n${buildReferencesBlock(uniqueSources, h.references)}`;

        // 마크다운 섹션 파싱 — ## 헤더 기반 분할 (regex보다 안정적)
        const sections = splitMarkdownSections(content);

        // 요약 섹션 찾기: 언어별 헤더 매칭
        const allSummaryHeaders = new Set(Object.values(SECTION_HEADERS).map(sh => sh.summary.toLowerCase()));
        const allFindingsHeaders = new Set(Object.values(SECTION_HEADERS).map(sh => sh.findings.toLowerCase()));

        const summarySection = sections.find(s => allSummaryHeaders.has(s.header.toLowerCase()));
        const findingsSection = sections.find(s => allFindingsHeaders.has(s.header.toLowerCase()));

        const summary = summarySection ? summarySection.body.trim() : content;

        const keyFindings = findingsSection
            ? findingsSection.body
                .split('\n')
                .map(line => line.trim())
                .filter(line => /^(?:\d+\.|[-•*])/.test(line))
                .map(line => line.replace(/^(?:\d+\.\s*|[-•*]\s*)/, '').trim())
                .filter(line => line.length > 0)
            : extractBulletLikeFindings(summary);

        await db.addResearchStep({
            sessionId,
            stepNumber: 999,
            stepType: 'report',
            query: '최종 보고서 생성',
            result: summary.slice(0, TRUNCATION.RESEARCH_SUMMARY_MAX),
            status: 'completed'
        });

        // A3: 인용 커버리지 측정 (결정적, LLM 비용 0). 본문은 변형하지 않고 메타만 기록.
        try {
            const citation = verifyCitations(content, uniqueSources.length);
            if (!citation.skipped) {
                const pct = citation.coverage !== null ? (citation.coverage * 100).toFixed(1) : 'N/A';
                const belowTarget = citation.meetsTarget === false;
                const logMsg = `[DeepResearch] 인용 커버리지: ${pct}% (${citation.citedClaims}/${citation.totalClaims}) `
                    + `invalid=${citation.invalidCitations.length} target=${(DEEP_RESEARCH_CITATION.TARGET_COVERAGE * 100).toFixed(0)}%`;
                if (belowTarget && DEEP_RESEARCH_CITATION.ENFORCE) {
                    logger.warn(`${logMsg} — 목표 미달 (ENFORCE)`);
                } else if (belowTarget) {
                    logger.info(`${logMsg} — 목표 미달`);
                } else {
                    logger.info(logMsg);
                }
                await db.addResearchStep({
                    sessionId,
                    stepNumber: 1000,
                    stepType: 'report',
                    query: '인용 검증',
                    result: JSON.stringify({
                        coverage: citation.coverage,
                        citedClaims: citation.citedClaims,
                        totalClaims: citation.totalClaims,
                        invalidCitations: citation.invalidCitations,
                        meetsTarget: citation.meetsTarget,
                        uncitedSamples: citation.uncitedSamples,
                    }),
                    status: belowTarget && DEEP_RESEARCH_CITATION.ENFORCE ? 'failed' : 'completed'
                });
            }
        } catch (verifyErr) {
            logger.warn(`[DeepResearch] 인용 검증 스킵(오류): ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`);
        }

        return { summary: content, keyFindings };
    } catch (error) {
        logger.error(`[DeepResearch] 보고서 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
        // fallback: 합성 결과를 간단한 보고서 형태로 조합 (참고문헌도 코드 마크다운 링크 사용)
        if (meaningfulFindings.length > 0) {
            const fallback = buildFallbackReport(config.language, topic, meaningfulFindings, buildReferencesBlock(uniqueSources, h.references));
            return { summary: fallback, keyFindings: extractBulletLikeFindings(meaningfulFindings.join('\n')) };
        }
        return { summary: getResearchMessage('reportFailed', config.language), keyFindings: [] };
    }
}

