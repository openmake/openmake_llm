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
import { deduplicateSources, extractBulletLikeFindings } from '../deep-research-utils';
import { SECTION_HEADERS, getReportPrompt, getResearchMessage } from '../deep-research-prompts';

const logger = createLogger('DeepResearch:ReportGenerator');

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

    try {
        const response = await client.chat([
            { role: 'user', content: prompt }
        ], { temperature: LLM_TEMPERATURES.RESEARCH_SYNTHESIS });
        throwIfAborted();

        const content = response.content;

        // Build regex matching all language variants for section headers
        const allSummaryHeaders = Object.values(SECTION_HEADERS).map(h => h.summary).join('|');
        const allFindingsHeaders = Object.values(SECTION_HEADERS).map(h => h.findings).join('|');
        const summaryMatch = content.match(new RegExp(`##\s*(?:${allSummaryHeaders})\s*\n([\s\S]*?)(?=##|$)`, 'i'));
        const summary = summaryMatch ? summaryMatch[1].trim() : content;

        const findingsMatch = content.match(new RegExp(`##\s*(?:${allFindingsHeaders})\s*\n([\s\S]*?)(?=##|$)`, 'i'));
        const keyFindings = findingsMatch
            ? findingsMatch[1]
                .split('\n')
                .map(line => line.trim())
                .filter(line => /^\d+\./.test(line))
                .map(line => line.replace(/^\d+\.\s*/, '').trim())
            : extractBulletLikeFindings(summary);

        await db.addResearchStep({
            sessionId,
            stepNumber: 999,
            stepType: 'report',
            query: '최종 보고서 생성',
            result: summary.slice(0, TRUNCATION.RESEARCH_SUMMARY_MAX),
            status: 'completed'
        });

        return { summary, keyFindings };
    } catch (error) {
        logger.error(`[DeepResearch] 보고서 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
        return { summary: getResearchMessage('reportFailed', config.language), keyFindings: [] };
    }
}

