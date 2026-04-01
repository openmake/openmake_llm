/**
 * ============================================================
 * ChatService 포맷팅 유틸리티
 * ============================================================
 *
 * 심층 연구 및 멀티 에이전트 토론 결과를 마크다운 형식으로 변환하는
 * 순수 함수(pure function)들을 제공합니다.
 *
 * @module services/chat-service-formatters
 */
<<<<<<< HEAD:backend/api/src/domains/chat/service/chat-service-formatters.ts
import type { DiscussionResult } from '../../../agents/discussion-engine';
=======
import type { DiscussionResult } from '../agents/discussion-engine';
import { DISCUSSION_CONSISTENCY } from '../config/runtime-limits';
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78:backend/api/src/services/chat-service-formatters.ts

/**
 * 심층 연구 결과를 마크다운 형식으로 포맷팅합니다.
 *
 * 종합 요약, 주요 발견사항, 참고 자료를 구조화된 마크다운으로 변환합니다.
 *
 * @param result - 연구 결과 객체
 * @param result.topic - 연구 주제
 * @param result.summary - 종합 요약
 * @param result.keyFindings - 주요 발견사항 목록
 * @param result.sources - 참고 자료 (제목 + URL)
 * @param result.totalSteps - 총 연구 단계 수
 * @param result.duration - 총 소요 시간 (밀리초)
 * @returns 마크다운 형식의 연구 보고서 문자열
 */
export function formatResearchResult(result: {
    topic: string;
    summary: string;
    keyFindings: string[];
    sources: Array<{ title: string; url: string }>;
    totalSteps: number;
    duration: number;
}): string {
    const sections = [
        `# 🔬 심층 연구 보고서: ${result.topic}`,
        '',
        '## 📋 종합 요약',
        result.summary,
        '',
        '## 🔍 주요 발견사항',
        ...result.keyFindings.map((finding, i) => `${i + 1}. ${finding}`),
        '',
        '## 📚 참고 자료',
        ...result.sources.map((source, i) => `[${i + 1}] [${source.title}](${source.url})`),
        '',
        '---',
        `*총 ${result.totalSteps}단계 연구, ${result.sources.length}개 소스 분석, ${(result.duration / 1000).toFixed(1)}초 소요*`,
    ];

    return sections.join('\n');
}

/**
 * 멀티 에이전트 토론 결과를 마크다운 형식으로 포맷팅합니다.
 *
 * 각 전문가별 분석 의견과 종합 답변을 구조화된 마크다운으로 변환합니다.
 *
 * @param result - 토론 결과 객체 (전문가 의견, 최종 답변, 토론 요약 포함)
 * @returns 마크다운 형식의 토론 결과 문자열
 */
export function formatDiscussionResult(result: DiscussionResult): string {
    let formatted = '';

    formatted += '## 🎯 멀티 에이전트 토론 결과\n\n';
    formatted += `> ${result.discussionSummary}\n\n`;
    formatted += '---\n\n';

    formatted += '## 📋 전문가별 분석\n\n';

    for (const opinion of result.opinions) {
        formatted += `### ${opinion.agentEmoji} ${opinion.agentName}\n\n`;
        formatted += `> 💭 **Thinking**: ${opinion.agentName} 관점에서 분석 중...\n\n`;
        formatted += `${opinion.opinion}\n\n`;
        formatted += '---\n\n';
    }

    // Self-Consistency Score 표시 (측정된 경우)
    if (result.consistencyScore != null) {
        const scorePercent = Math.round(result.consistencyScore * 100);
        const isLowConsistency = result.consistencyScore < DISCUSSION_CONSISTENCY.MIN_REQUIRED_SCORE;

        formatted += '### 📊 의견 일관성 분석\n\n';
        formatted += `**합의도**: ${scorePercent}%`;
        if (isLowConsistency) {
            formatted += ' ⚠️ *전문가 간 의견이 분분합니다. 다양한 관점을 참고하세요.*';
        }
        formatted += '\n\n';

        if (result.consensusPoints && result.consensusPoints.length > 0) {
            formatted += '**합의 사항:**\n';
            for (const point of result.consensusPoints) {
                formatted += `- ✅ ${point}\n`;
            }
            formatted += '\n';
        }
        if (result.conflictPoints && result.conflictPoints.length > 0) {
            formatted += '**의견 차이:**\n';
            for (const point of result.conflictPoints) {
                formatted += `- ⚡ ${point}\n`;
            }
            formatted += '\n';
        }
        formatted += '---\n\n';
    }

    formatted += '<details open>\n<summary>💡 <strong>종합 답변</strong> (전문가 의견 종합)</summary>\n\n';
    formatted += result.finalAnswer;
    formatted += '\n\n</details>';

    return formatted;
}
