/**
 * 슬래시 스킬 호출 시 **사용자 발화**가 세션 제목·대화기록에 저장되는지 회귀 테스트.
 *
 * 종전엔 확장문(`[슬래시 명령: 스킬 "x" 적용]` + 스킬 본문 수천 자)이 그대로 저장돼
 * ① 히스토리 제목이 내부 문구로 뜨고(운영 13건) ② 사용자 메시지 자리에 스킬 문서가 보이고
 * ③ 다음 턴 history 로 재전송돼 토큰을 낭비했다 (2026-09-13 라이브 점검).
 *
 * processChat 전체는 LLM·DB 의존이 커서, 여기서는 저장에 쓰는 값의 선택 규칙만 고정한다.
 * (request-handler.ts 의 userFacingMessage 와 같은 식 — 바뀌면 여기도 함께 바꿀 것)
 */

function pickUserFacingMessage(originalMessage: string | undefined, rawMessage: string | undefined, expanded: string): string {
    return (originalMessage ?? rawMessage ?? '').trim() || expanded;
}

describe('슬래시 확장문은 저장 대상이 아니다', () => {
    const expanded = '[슬래시 명령: 스킬 "비즈니스 이메일 작성" 적용]\n<skill_context>…수천 자…</skill_context>\n회의 일정 변경 메일';

    it('WS 경로: originalMessage(확장 전 원문)를 저장한다', () => {
        expect(pickUserFacingMessage('/비즈니스-이메일-작성 회의 일정 변경 메일', undefined, expanded))
            .toBe('/비즈니스-이메일-작성 회의 일정 변경 메일');
    });

    it('REST 경로: rawMessage 가 원문이다', () => {
        expect(pickUserFacingMessage(undefined, '/보고서-작성 3분기 매출 정리', expanded))
            .toBe('/보고서-작성 3분기 매출 정리');
    });

    it('둘 다 없으면 확장문으로 폴백(저장 자체는 유지)', () => {
        expect(pickUserFacingMessage(undefined, undefined, expanded)).toBe(expanded);
        expect(pickUserFacingMessage('   ', undefined, expanded)).toBe(expanded);
    });

    it('슬래시가 아닌 일반 메시지는 그대로', () => {
        expect(pickUserFacingMessage(undefined, '안녕하세요', '안녕하세요')).toBe('안녕하세요');
    });

    it('저장값이 확장문 머리말을 담지 않는다 (제목 오염 방지)', () => {
        const stored = pickUserFacingMessage('/보고서-작성 정리해줘', undefined, expanded);
        expect(stored.startsWith('[슬래시 명령')).toBe(false);
        expect(stored.length).toBeLessThan(60);
    });
});
