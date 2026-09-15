/**
 * @module agents/system-skill-names
 * @description 시스템 시드 스킬의 이름 규칙과 영어 표시 이름.
 *
 * 시드 스킬 이름(agent_skills.name)이 한국어라 영문 UI 의 스킬 칩에 한국어가 나왔다(2026-09-14).
 * DB 이름은 그대로 두고 WS skills_activated 에 영어 표시 이름을 함께 실어 UI 가 로케일로 고른다.
 * 산업·범용 에이전트 스킬 이름 규칙은 시더(skill-seeder)와 이 모듈이 공유한다.
 */
import { AGENTS } from './agent-data';
import { UTILITY_SKILLS_A } from './utility-skills-data-a';
import { UTILITY_SKILLS_B } from './utility-skills-data-b';

/** general 에이전트 시스템 스킬 이름 */
export const GENERAL_SYSTEM_SKILL_NAME = '범용 AI 어시스턴트 스킬';

/** 산업 에이전트 시스템 스킬 이름 */
export function industrySkillName(agentName: string): string {
    return `${agentName} 전문 스킬`;
}

let namesEn: Map<string, string> | null = null;

function buildNamesEn(): Map<string, string> {
    const map = new Map<string, string>();
    for (const agent of Object.values(AGENTS)) {
        if (!agent.nameEn) continue;
        const name = agent.id === 'general' ? GENERAL_SYSTEM_SKILL_NAME : industrySkillName(agent.name);
        map.set(name, `${agent.nameEn} Skill`);
    }
    for (const skill of [...UTILITY_SKILLS_A, ...UTILITY_SKILLS_B]) {
        if (skill.nameEn) map.set(skill.name, skill.nameEn);
    }
    return map;
}

/** 스킬 이름 중 시스템 스킬의 영어 표시 이름 맵 — 해당이 없으면 undefined(이벤트에서 필드 생략) */
export function systemSkillNamesEn(names: readonly string[]): Record<string, string> | undefined {
    namesEn ??= buildNamesEn();
    const out: Record<string, string> = {};
    for (const name of names) {
        const en = namesEn.get(name);
        if (en) out[name] = en;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
