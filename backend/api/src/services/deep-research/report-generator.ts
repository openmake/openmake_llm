/**
 * Deep Research - 보고서 생성 모듈
 *
 * 최종 리서치 보고서를 생성하는 기능을 제공합니다.
 *
 * @module services/deep-research/report-generator
 */

import type { OllamaClient } from '../../ollama/client';
import type { SearchResult } from '../../mcp/web-search';
import type { ResearchConfig, SubTopic } from '../deep-research-types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { TRUNCATION } from '../../config/runtime-limits';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import { deduplicateSources, extractBulletLikeFindings } from '../deep-research-utils';
import { SECTION_HEADERS, getReportPrompt, getResearchMessage } from '../deep-research-prompts';

const logger = createLogger('DeepResearch:ReportGenerator');

interface MarkdownSection {
    header: string;
    body: string;
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
    client: OllamaClient;
    config: ResearchConfig;
    topic: string;
    findings: string[];
    sources: SearchResult[];
    subTopics: SubTopic[];
    sessionId: string;
    throwIfAborted: () => void;
}): Promise<{ summary: string; keyFindings: string[] }> {
    const { client, config, topic, findings, sources, subTopics, sessionId, throwIfAborted } = params;

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

    const subTopicGuide = subTopics
        .map((subTopic, index) => `${index + 1}. ${subTopic.title}`)
        .join('\n');

    const prompt = getReportPrompt(config.language, topic, subTopicGuide, meaningfulFindings, sourceList);

    // 보고서 생성에 타임아웃 적용
    const reportController = new AbortController();
    const reportTimeout = setTimeout(
        () => reportController.abort(),
        LLM_TIMEOUTS.REPORT_GENERATION_TIMEOUT_MS,
    );

    try {
        const response = await client.chat([
            { role: 'user', content: prompt }
        ], { temperature: LLM_TEMPERATURES.RESEARCH_SYNTHESIS });
        throwIfAborted();

        const content = response.content;

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

        return { summary: content, keyFindings };
    } catch (error) {
        logger.error(`[DeepResearch] 보고서 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
        // fallback: 합성 결과를 간단한 보고서 형태로 조합
        if (meaningfulFindings.length > 0) {
            const fallback = buildFallbackReport(config.language, topic, meaningfulFindings, sourceList);
            return { summary: fallback, keyFindings: extractBulletLikeFindings(meaningfulFindings.join('\n')) };
        }
        return { summary: getResearchMessage('reportFailed', config.language), keyFindings: [] };
    } finally {
        clearTimeout(reportTimeout);
    }
}

