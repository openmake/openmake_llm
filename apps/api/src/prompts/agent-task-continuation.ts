/** 이어가기(188) 프롬프트 — 인계 턴 질문과 후속 작업 첫 메시지의 "다음에 할 일" 절 머리. */
export const CONTINUATION_NEXT_STEPS_HEADING = '## 다음에 할 일';

export function getContinuationNextStepsPrompt(maxChars: number): string {
    return '이 작업은 컨텍스트 한도 때문에 새 세션으로 이어집니다. 다음 세션이 바로 이어서 할 수 있도록 '
        + '지금까지 끝낸 것은 빼고, **남은 일만** 순서대로 번호 목록으로 적으세요. 각 항목은 한 줄, '
        + `전체 ${maxChars}자 이내, 도구는 부르지 마세요.`;
}

export const CONTINUATION_NO_NEXT_STEPS = '(모델 응답 없음 — 계획과 파일 목록을 보고 이어서 진행)';

/** 후속 작업 첫 메시지 머리 — 인계 요약(HANDOFF_SUMMARY_MARKER) 뒤에 붙는 절. */
export function getContinuationNotice(segmentIndex: number, reason: string): string {
    return `이 작업은 앞 세션(세그먼트 ${segmentIndex - 1})에서 ${reason === 'context' ? '컨텍스트 한도' : reason === 'tokens' ? '토큰 예산' : '턴 상한'} 때문에 이어진 세션 ${segmentIndex} 입니다. `
        + '작업 공간의 파일은 그대로 있습니다. 위 요약과 아래 "다음에 할 일" 부터 이어서 진행하세요.';
}
