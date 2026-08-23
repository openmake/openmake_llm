/**
 * 답변 검증 프롬프트 — 채팅 답변을 judge 모델이 1회 점검한다.
 *
 * 설계 근거(2026-08-23 프로토타입 실측): 로컬 모델이 "국민연금 의무가입 상한 없음" 처럼
 * 사실과 다른 답을 냈을 때 judge 모델이 정확히 반박했다(4회 비평 모두 구체적 지적, 아첨 없음).
 * 반면 **수정 왕복은 손해**였다 — 2건 중 1건에서 수정본이 원본보다 나빠졌고(본문 소실),
 * 2건 모두 수렴하지 않았다. 그래서 여기서는 **지적만 하고 고치지 않는다**.
 *
 * "없으면 NONE" 규약은 프로토타입에서 잘 작동했다 — 지적할 게 없을 때 억지 비평을 만들지 않는다.
 *
 * @module prompts/answer-verification
 */

/** 오류 없음 신호 — 이 토큰으로 시작하면 사용자에게 아무것도 표시하지 않는다. */
export const VERIFICATION_NONE = 'NONE';

export function getAnswerVerificationMessages(
    userMessage: string,
    answer: string,
    lang: 'ko' | 'en',
): { system: string; user: string } {
    const system = lang === 'ko'
        ? [
            '당신은 다른 AI 답변의 오류를 찾는 검증자다.',
            '사실오류·논리오류·중요한 누락만 지적한다.',
            '지적할 것이 없으면 첫 줄에 정확히 "NONE" 만 출력한다.',
            '칭찬·요약·재작성은 하지 않는다. 답변을 고쳐 쓰지 않는다.',
            '지적은 최대 3개, 각 한 문장. 확신이 없으면 지적하지 않는다.',
        ].join('\n')
        : [
            'You verify another AI answer and report only its errors.',
            'Report factual errors, logical errors, or critical omissions only.',
            'If there is nothing to report, output exactly "NONE" on the first line.',
            'Do not praise, summarize, or rewrite the answer.',
            'At most 3 points, one sentence each. If unsure, do not report it.',
        ].join('\n');

    const user = lang === 'ko'
        ? `[질문]\n${userMessage}\n\n[답변]\n${answer}`
        : `[Question]\n${userMessage}\n\n[Answer]\n${answer}`;

    return { system, user };
}
