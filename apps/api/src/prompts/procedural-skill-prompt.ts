/**
 * 절차 스킬 안내문 — 에이전트 작업 system 프롬프트에 덧붙는 블록과 skill_save 거절 문구.
 *
 * @module prompts/procedural-skill-prompt
 */

/** 저장 유도(항상) — 반복 가능한 절차를 완료하면 skill_save 로 저장해 다음에 재사용하게 한다. */
export const PROCEDURAL_SAVE_HINT_LINES: readonly string[] = [
    '',
    '## 절차 재사용 (Procedural Skill)',
    '브라우저/스크립트로 반복 가능한 작업을 성공적으로 마쳤다면, 그 액션 시퀀스를 skill_save 로 저장하세요',
    '(반복되는 값은 {{param}} 로 일반화). 다음에 유사 작업에서 skill_run 으로 재추론 없이 재생할 수 있습니다.',
];

/** 재사용 후보 목록 앞에 붙는 안내. */
export const PROCEDURAL_REUSE_LINES: readonly string[] = [
    '',
    '### 지금 재사용 가능한 절차 (skill_run 으로 즉시 재생)',
    '아래는 과거에 성공해 저장된 실행 절차입니다. 목표에 부합하면 처음부터 다시 추론하지 말고',
    'skill_run 을 아래 정확한 skill_id(권장) 또는 스킬 이름과 params 로 호출해 그대로 재생하세요.',
    '재생 결과가 목표와 다르면 수동으로 진행하세요.',
];

/** skill_save 거절 — 평문 비밀 값이 들어 있을 때. 값 자체는 싣지 않는다(위치만). */
export function proceduralSecretRejection(locations: readonly string[]): string {
    return [
        '저장하지 않았습니다 — 절차에 비밀 값이 평문으로 들어 있습니다:',
        ...locations.map((l) => `- ${l}`),
        '해당 값을 {{password}} 같은 {{param}} 으로 바꾸고 params 에 이름을 넣어 다시 skill_save 하세요.',
    ].join('\n');
}
