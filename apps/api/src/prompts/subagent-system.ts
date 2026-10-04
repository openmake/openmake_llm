/**
 * ============================================================
 * Subagent System Prompt — 위임 규약 공통 블록
 * ============================================================
 *
 * runSubagent(services/agent-task/subagent.ts)가 페르소나 프롬프트 뒤에
 * 덧붙이는 서브에이전트 공통 규약(턴 상한·도구 범위·재위임 불가·언어 순수성)과,
 * 마지막 턴 진입을 모델에게 알리는 안내문.
 *
 * @module prompts/subagent-system
 */

/** 페르소나 뒤에 덧붙는 위임 규약 블록 */
export function buildSubagentDelegationRules(maxTurns: number, toolNames: readonly string[], requestLanguage: string): string {
    return [
        '당신은 상위 자율 에이전트로부터 하위 목표를 위임받은 서브에이전트입니다.',
        `- 최대 ${maxTurns}턴 안에 끝내세요. 필요한 경우에만 도구를 쓰고, 즉시 답할 수 있으면 바로 답하세요.`,
        // 도구 범위 — 실행 도구가 없는 서브가 "bash 로 파일 만드는 법"을 웹 검색하려다 승인 카드를 띄웠다(2026-10-04 라이브 관측).
        (toolNames.length > 0 ? `- 쓸 수 있는 도구는 ${toolNames.join(', ')}뿐입니다.` : '- 쓸 수 있는 도구가 없습니다.')
        + ' 여기에 없는 일(셸 실행·파일 쓰기 등)은 직접 할 수 없으니, 시도하거나 방법을 검색하지 말고 상위 에이전트가 실행할 방법·명령을 답에 적으세요.',
        '- 다른 에이전트에게 재위임할 수 없습니다.',
        '- 최종 응답은 상위 에이전트가 그대로 활용할 간결·구체적인 결과여야 합니다.',
        // 스크립트 순수성 — qwen 이 한국어 답변에 한자(诸費用·以内 등)를 섞는 결함이
        // 서브 응답 경유로 유입되던 문제 차단(채팅 메인 경로 가드와 동일 정책, 라이브 관측).
        // 응답 언어는 이름으로 짚는다 — "위임 요청과 같은 언어로"만 두면 영문 토큰(bash·README 등)이 섞인 한국어 위임에
        // 영어로 답했다(2026-10-04 측정: 그런 위임 2종에서 6/12 → 이름으로 짚으면 0/12).
        `- 응답 언어: ${requestLanguage}. 위임 요청과 같은 이 언어로 설명 문장을 쓰세요 — 코드·명령·파일 이름·식별자만 원문 그대로 둡니다. `
        + '그 언어의 고유 문자만 사용하세요 — 한국어 답변에 한자·'
        + '가나를 섞지 말고, 외래어·전문용어는 해당 언어로 음차하거나 번역하세요.',
    ].join('\n');
}

/**
 * 마지막 턴 진입 안내 — 도구를 조용히 제거하면 qwen 이 raw <tool_call> XML 을
 * 텍스트로 뱉어 스텁 결과가 되는 결함 차단(2026-07-12 spawn_agents 라이브 관측).
 */
export const SUBAGENT_FINAL_TURN_NOTICE =
    '이제 도구를 더 사용할 수 없습니다. 지금까지 수집한 내용만으로 최종 결과를 바로 작성하세요.';

/** spawn_agents 결과의 제목. */
export function getSpawnResultTitle(taskCount: number): string {
    return `[병렬 서브에이전트 결과 — ${taskCount}개 태스크]`;
}

/** 결과를 반환하지 못한 태스크 자리에 넣는 문구. */
export const SPAWN_MISSING_RESULT = 'Error: 서브에이전트가 결과를 반환하지 못했습니다.';

/** 태스크 상한 초과분 안내(silent cap 금지). */
export function getSpawnDroppedNote(maxTasks: number, droppedCount: number): string {
    return `\n\n(주의: 태스크 상한 ${maxTasks}개 초과분 ${droppedCount}개는 수행되지 않았습니다.)`;
}

/**
 * 종합 강제 넛지 — 라이브 관측: qwen 이 spawn 결과를 받고도 같은 주제를 재검색하며
 * 턴 예산을 소진해 최종 종합 턴이 사라짐. 도구 결과 말미의 결정적 지시로 차단.
 */
export function getSpawnSynthesisNudge(): string {
    return '\n\n지시: 위 서브에이전트 결과만으로 지금 바로 최종 답변을 종합해 작성하세요. '
        + '같은 주제를 다시 검색하거나 추가 도구를 호출하지 마세요.';
}

/**
 * 상한(턴·토큰)에 걸려 끝난 서브에이전트의 결과 — 부모가 완주한 결과와 구분할 수 있게 머리말을 붙인다.
 * 종전에는 표식이 활동 기록에만 남고 부모에게는 정상 결과처럼 돌아갔다.
 */
export function partialSubagentResult(reason: 'turns' | 'tokens', text: string): string {
    const why = reason === 'turns' ? '턴 상한 도달' : '토큰 상한 도달';
    return `[서브에이전트 상태: ${why} — 부분 결과]\n${text || '(부분 결과 없음)'}`;
}
