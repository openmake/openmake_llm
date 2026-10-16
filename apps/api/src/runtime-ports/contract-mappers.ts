/**
 * Base 저장소 행 → 계약 DTO 변환 (설계 3차 §3 C2).
 *
 * 포트가 add-on 에 넘기는 값은 저장소 타입이 아니라 계약 DTO(`@openmake/plugin-contracts`)다 — 저장소 열이 바뀌어도
 * add-on 이 보는 모양은 이 파일에서만 맞추면 된다. 순수 함수만 둔다.
 *
 * @module runtime-ports/contract-mappers
 */
import type { AddonInstallationIntent, SkillRecordDTO } from '@openmake/plugin-contracts';
import type { AgentSkill } from '../data/repositories/skill-repository';
import type { AddonInstallationRow } from '../data/repositories/addon-state-repository';

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

/** PURE: 설치 표 행 → 부팅 절차가 보는 의도(관리자 의도와 호환 state 만) */
export function toAddonInstallationIntent(row: Pick<AddonInstallationRow, 'addon_id' | 'desired_state' | 'state'>): AddonInstallationIntent {
    return { addonId: row.addon_id, desiredState: row.desired_state, state: row.state };
}
