/**
 * 스킬 저장소 행 → 계약 DTO 변환 — 포트(`runtime-ports/skill-runtime.ts`)로 넘기는 값은 저장소 타입이 아니라
 * `SkillRecordDTO`(`@openmake/plugin-contracts`)다. 저장소를 이 add-on 으로 옮기며(2026-10-18) `runtime-ports/contract-mappers.ts` 에서 옮겨 왔다.
 *
 * @module addons/skill-runtime/data/skill-record-dto
 */
import type { SkillRecordDTO } from '@openmake/plugin-contracts';
import type { AgentSkill } from './skill-repository';

/** PURE: 스킬 저장소 행 → SkillRecordDTO (시각은 ISO 문자열, 없는 선택 필드는 null, 저장소 전용 필드는 뺀다) */
export function toSkillRecordDTO(skill: AgentSkill): SkillRecordDTO {
    return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: skill.content,
        category: skill.category,
        isPublic: skill.isPublic,
        status: skill.status ?? null,
        sourcePath: skill.sourcePath ?? null,
        extensionId: skill.extensionId ?? null,
        createdBy: skill.createdBy ?? null,
        createdAt: skill.createdAt.toISOString(),
        updatedAt: skill.updatedAt.toISOString(),
    };
}
