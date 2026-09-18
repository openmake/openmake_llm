/**
 * 토론 결과 포맷 — 종전 services/chat-service-formatters.ts 에서 옮겼다(2026-09-19).
 *
 * @module addons/discussion/format
 */
import type { DiscussionResult } from './engine';
import { DISCUSSION_CONSISTENCY } from './config';
import { buildDiscussionSourcesBlock } from './sources';

/**
 * 멀티 에이전트 토론 결과를 마크다운 형식으로 포맷팅합니다.
 *
 * 각 전문가별 분석 의견과 종합 답변을 구조화된 마크다운으로 변환합니다.
 *
 * @param result - 토론 결과 객체 (전문가 의견, 최종 답변, 토론 요약 포함)
 * @returns 마크다운 형식의 토론 결과 문자열
 */
export function formatDiscussionResult(result: DiscussionResult, userLanguage?: string): string {
    let formatted = '';

    formatted += '## 🎯 멀티 에이전트 토론 결과\n\n';
    formatted += `> ${result.discussionSummary}\n\n`;
    formatted += '---\n\n';

    // 축소 완료(최소 인원 미달) 고지 — 복수 관점 비교가 성립하지 않았음을 사용자에게 알린다.
    if (result.degraded) {
        formatted += `> ⚠️ 일부 전문가의 의견 생성이 실패해 ${result.participants.length}명만 참여했습니다. `
            + '복수 관점 비교가 제한적입니다.\n\n';
    }

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

    // 마크다운 헤딩으로 구분 — 종전엔 raw HTML(`<details open><summary>…`)을 썼는데,
    // 프론트 마크다운 렌더러는 XSS 방어로 rehype-raw 를 쓰지 않아 태그가 렌더되지 않고
    // 닫는 `</details>` 가 본문에 그대로 노출됐다(2026-09-13 라이브 점검).
    formatted += '## 💡 종합 답변 (전문가 의견 종합)\n\n';
    formatted += result.finalAnswer;

    // 출처 결정적 첨부 — 도구 경유 경로(orchestration-dispatch)와 대칭.
    // 종합 답변 섹션 뒤에 두어 근거가 항상 보이도록 한다.
    formatted += buildDiscussionSourcesBlock(result.finalAnswer, result.sources, userLanguage);

    return formatted;
}
