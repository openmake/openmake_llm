/**
 * industry-pack 스킬 컴파일러 — 저작 도구 (2026-09-19).
 *
 * 산업 에이전트의 전문 스킬 원본은 사람이 쓴 `skills/<산업>/<agent>.md` 다. 이 모듈은 그 본문과
 * `industry-agents.json` 의 메타데이터를 묶어 설치 형식 `skills.json` 을 만든다.
 * **런타임은 이 모듈을 부르지 않는다** — `skills.json` 이 설치 SoT 이고(addon-host/pack-skills.ts), md 나
 * 에이전트 정의를 고친 뒤 `npm run addons:build --workspace=apps/api` 로 다시 만든다.
 * 산출물이 원본과 어긋나면 `authoring/__tests__/industry-pack-skills.test.ts` 가 실패한다.
 *
 * 종전(~v1.74)에는 분야 공통 지식 JSON 과 키워드에서 본문을 자동 조립했고 md 는 운영에서 읽히지 않았다.
 *
 * @module addon-host/authoring/industry-pack-skills
 */
import * as fs from 'fs';
import * as path from 'path';
import type { IndustryAgentsData } from '../../agents/types';
import { builtinAddonDir } from '../builtin-registry';
import type { PackSkillDef } from '../pack-skills';

/** 산업 팩의 전체 스킬 정의 — id·이름·source_path 규칙은 종전 시더와 같다(DB 행 id 가 그대로 유지된다). */
export function buildIndustryPackSkills(): PackSkillDef[] {
    const packDir = builtinAddonDir('industry-pack');
    const industryData = JSON.parse(fs.readFileSync(path.join(packDir, 'industry-agents.json'), 'utf-8')) as IndustryAgentsData;
    const skills: PackSkillDef[] = [];
    for (const [categoryId, categoryInfo] of Object.entries(industryData)) {
        for (const agent of categoryInfo.agents) {
            // 원본이 없으면 throw — 스킬 없는 에이전트가 조용히 생기지 않게 한다
            const content = fs.readFileSync(path.join(packDir, 'skills', categoryId, `${agent.id}.md`), 'utf-8').trim();
            skills.push({
                id: `system-skill-${agent.id}`,
                name: `${agent.name} 전문 스킬`,
                ...(agent.nameEn ? { nameEn: `${agent.nameEn} Skill` } : {}),
                description: agent.description,
                category: categoryId,
                sourcePath: `agents/prompts/${categoryId}/${agent.id}.md`,
                assignToAgent: agent.id,
                content,
            });
        }
    }
    return skills;
}
