/**
 * notFound 메시지 조립 회귀 테스트.
 * 종전엔 인자 뒤에 무조건 '를 찾을 수 없습니다' 를 붙여, 완성 문장을 넘기는 호출부에서
 * "…찾을 수 없습니다.를 찾을 수 없습니다" 가 사용자에게 나갔다(2026-09-13 라이브 점검).
 */
import { notFoundMessage } from '../api-response';

describe('notFoundMessage', () => {
    it('명사는 받침에 맞는 조사로 접미한다', () => {
        expect(notFoundMessage('스킬')).toBe('스킬을 찾을 수 없습니다');   // 받침 ㄹ
        expect(notFoundMessage('에이전트')).toBe('에이전트를 찾을 수 없습니다'); // 받침 없음
        expect(notFoundMessage('세션')).toBe('세션을 찾을 수 없습니다');
    });

    it('이미 완결된 문장은 그대로 둔다 (이중 접미 금지)', () => {
        expect(notFoundMessage('작업을 찾을 수 없습니다.')).toBe('작업을 찾을 수 없습니다.');
        expect(notFoundMessage('리서치 세션을 찾을 수 없습니다.')).toBe('리서치 세션을 찾을 수 없습니다.');
        expect(notFoundMessage('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'))
            .toBe('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).');
        expect(notFoundMessage('agent 없음')).toBe('agent 없음');
        expect(notFoundMessage('확장 없음 또는 이미 제거됨')).toBe('확장 없음 또는 이미 제거됨');
    });

    it('영문 안내 문장도 그대로', () => {
        expect(notFoundMessage('Key not found or already inactive')).toBe('Key not found or already inactive');
    });

    it('영문 명사는 를 (관용)', () => {
        expect(notFoundMessage('API Key')).toBe('API Key를 찾을 수 없습니다');
    });

    it('빈 값은 기본 문구', () => {
        expect(notFoundMessage('   ')).toBe('리소스를 찾을 수 없습니다');
    });
});
