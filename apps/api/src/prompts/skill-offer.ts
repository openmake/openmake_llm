/**
 * 스킬 후보 제시 블록 (2026-09-11) — manifest 합계 상한을 넘은 턴에 본문 대신 싣는다.
 * 무엇을 불러올지는 모델이 같은 턴에 load_skill 로 판단한다 (agents/manifest-injection-plan 참고).
 * @module prompts/skill-offer
 */
import { LOAD_SKILL_TOOL_NAME } from '../mcp/load-skill-tool';

export interface SkillOfferItem {
    name: string;
    description: string;
    chars: number;
}

export function buildSkillOfferBlock(items: readonly SkillOfferItem[]): string {
    const lines = items.map((item) => {
        const name = item.name.replace(/[<>"&]/g, '');
        const size = `${(item.chars / 1000).toFixed(1)}K자`;
        return item.description ? `- ${name} (${size}): ${item.description}` : `- ${name} (${size})`;
    });
    return [
        '<skill_offer>',
        `이 질문과 관련된 스킬이 여러 개라 본문을 미리 싣지 않았다. 답에 실제로 필요한 스킬만 \`${LOAD_SKILL_TOOL_NAME}\` 로 `
            + '불러와 그 지침을 따르라(보통 1~2개). 필요 없으면 부르지 않는다.',
        ...lines,
        '</skill_offer>',
    ].join('\n');
}
