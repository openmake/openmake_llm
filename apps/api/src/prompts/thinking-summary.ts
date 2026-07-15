/**
 * @module prompts/thinking-summary
 * @description thinking 요약 헤드라인 프롬프트 — 클로드 웹식 표시.
 *
 * 생각(내부 추론) 원문을 받아 "무엇을 했는지" 한 문장 과거형 헤드라인을 만든다.
 * 예: "근거리 이동 수단 선택지를 비교 검토했습니다"
 * 사용자 질문과 같은 언어로 출력 (thinking 원문이 영어여도 헤드라인은 질문 언어).
 */

export function getThinkingSummaryMessages(
    userMessage: string,
    thinking: string,
    /** progress = 생각 진행 중 (현재진행형 헤드라인), final = 생각 종료 (과거형) */
    mode: 'progress' | 'final' = 'final',
): { system: string; user: string } {
    const tense = mode === 'progress'
        ? '- 현재진행형 서술 한 문장, 40자 이내 (예: "근거리 이동 수단 선택지를 비교하는 중입니다")'
        : '- 정중한 과거형 서술 한 문장, 40자 이내 (예: "근거리 이동 수단 선택지를 비교 검토했습니다")';
    return {
        system: [
            '당신은 AI 의 내부 추론 과정을 한 줄 헤드라인으로 요약하는 도우미입니다.',
            '규칙:',
            '- 반드시 사용자 질문과 같은 언어로 작성',
            tense,
            '- 추론에서 실제로 수행한 검토/비교/분석 행위를 요약 — 결론 내용은 포함하지 않음',
            '- 따옴표, 접두어, 설명 없이 헤드라인 문장만 출력',
        ].join('\n'),
        user: `[사용자 질문]\n${userMessage}\n\n[AI 내부 추론]\n${thinking}\n\n위 추론 과정을 헤드라인 한 문장으로:`,
    };
}
