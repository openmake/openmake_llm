/**
 * Base 저장소 행 → 계약 DTO 변환 (설계 3차 §3 C2).
 *
 * 포트가 add-on 에 넘기는 값은 저장소 타입이 아니라 계약 DTO(`@openmake/plugin-contracts`)다 — 저장소 열이 바뀌어도
 * add-on 이 보는 모양은 이 파일에서만 맞추면 된다. 순수 함수만 둔다.
 * 스킬 행 → `SkillRecordDTO` 는 스킬 저장소와 함께 add-on 으로 옮겼다(`addons/skill-runtime/data/skill-record-dto.ts`, 2026-10-18).
 *
 * @module runtime-ports/contract-mappers
 */
import type { AddonInstallationIntent } from '@openmake/plugin-contracts';
import type { AddonInstallationRow } from '../data/repositories/addon-state-repository';

/** PURE: 설치 표 행 → 부팅 절차가 보는 의도(관리자 의도와 호환 state 만) */
export function toAddonInstallationIntent(row: Pick<AddonInstallationRow, 'addon_id' | 'desired_state' | 'state'>): AddonInstallationIntent {
    return { addonId: row.addon_id, desiredState: row.desired_state, state: row.state };
}
