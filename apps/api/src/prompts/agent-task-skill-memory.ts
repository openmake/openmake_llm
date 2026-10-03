/**
 * 에이전트 작업의 스킬·학습·메모리 문구 (hermes 도입 2단계 — 영역 5).
 * 모델에게 돌려주는 도구 결과·도구 설명·system 프롬프트 블록 머리말.
 *
 * @module prompts/agent-task-skill-memory
 */

/** skill_save 인자 설명 — 고쳐 쓰기·되돌리기. */
export const SKILL_SAVE_UPDATE_ARG_DESCRIPTION = '같은 이름의 내 스킬이 이미 있을 때 true 면 그 스킬을 이 내용으로 고쳐 씁니다(버전이 오르고 직전 본문은 보존). 없으면 새로 저장합니다.';
export const SKILL_SAVE_REVERT_ARG_DESCRIPTION = 'true 면 name 의 스킬을 직전 본문으로 되돌립니다(name 만 필요, 다른 인자는 무시).';

/** skill_save 거절 — 같은 이름의 스킬이 이미 있다. */
export function proceduralSkillExistsMessage(existing: { id: string; name: string; version: number }): string {
    return `같은 이름의 절차 스킬이 이미 있습니다: "${existing.name}" (skill_id=${existing.id}, v${existing.version}). `
        + '그 스킬을 고쳐 쓰려면 update=true 로 다시 skill_save 하고, 다른 절차라면 다른 이름으로 저장하세요. 그대로 쓸 수 있으면 skill_run 으로 재생하세요.';
}

/** skill_save revert 실패 — 되돌릴 대상이 없다. */
export function proceduralRevertUnavailableMessage(name: string, reason: 'not_found' | 'no_previous'): string {
    return reason === 'not_found'
        ? `되돌릴 절차 스킬을 찾지 못했습니다: "${name}"`
        : `"${name}" 에는 보존된 직전 본문이 없습니다(한 번도 고쳐 쓰지 않았습니다).`;
}

/** skill_save 성공 문구. */
export function proceduralSavedMessage(r: { id: string; version: number; updated: boolean }, reverted = false): string {
    if (reverted) return `절차 스킬을 직전 본문으로 되돌렸습니다: skill_id=${r.id} (v${r.version}).`;
    return r.updated
        ? `절차 스킬을 고쳐 썼습니다: skill_id=${r.id} (v${r.version}, 직전 본문 보존 — revert=true 로 되돌릴 수 있습니다).`
        : `절차 스킬 저장됨: skill_id=${r.id}. 다음에 skill_run 으로 재생하세요.`;
}

/** 절차 구조 검사 — 문제 한 줄(위치 포함). */
export const PROCEDURAL_STRUCTURE_PROBLEMS = {
    noActions: () => 'actions 가 비어 있습니다 — 재생할 단계가 없습니다',
    emptyStep: (i: number) => `actions[${i}] 가 빈 단계입니다(type 이 있는 객체여야 합니다)`,
    unknownAction: (i: number, type: string, known: readonly string[]) => `actions[${i}] 의 type "${type}" 은 알 수 없는 액션입니다 — 쓸 수 있는 액션: ${known.join(', ')}`,
    missingField: (i: number, type: string, field: string) => `actions[${i}] (${type}) 에 ${field} 가 없습니다`,
    emptyCode: () => 'code 가 비어 있습니다',
} as const;

/** skill_save 거절 — 절차 본문 구조에 문제가 있다. */
export function proceduralStructureRejection(problems: readonly string[]): string {
    return ['저장하지 않았습니다 — 절차 본문에 문제가 있습니다:', ...problems.map((p) => `- ${p}`), '고쳐서 다시 skill_save 하세요.'].join('\n');
}

/** skill_save 거절 — 이동 주소가 막힌 대상(사설망 등)이다. 뒤에 주소 가드의 안내가 붙는다. */
export const PROCEDURAL_URL_REJECTION_PREFIX = '저장하지 않았습니다 — 이 절차는 재생해도 이동이 막힙니다.';
