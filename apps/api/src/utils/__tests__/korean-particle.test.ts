/** 한국어 조사 선택 — 사용자 노출 문구의 '이(가)' 표기를 없애기 위한 순수 함수 */
import { hasFinalConsonant, subjectParticle, objectParticle, topicParticle, instrumentalParticle } from '../korean-particle';

describe('korean-particle', () => {
    it('받침 판정', () => {
        expect(hasFinalConsonant('심리학자')).toBe(false); // 자 — 받침 없음
        expect(hasFinalConsonant('변호사')).toBe(false);
        expect(hasFinalConsonant('의사')).toBe(false);
        expect(hasFinalConsonant('엔지니어')).toBe(false);
        expect(hasFinalConsonant('기획전문')).toBe(true);  // 문 — 받침 ㄴ
        expect(hasFinalConsonant('개발자님')).toBe(true);
        expect(hasFinalConsonant('agent')).toBe(false);    // 비한글
    });

    it('주격 — 토론 진행 문구의 실제 사례', () => {
        expect(`심리학자${subjectParticle('심리학자')}`).toBe('심리학자가');
        expect(`영상 프로듀서${subjectParticle('영상 프로듀서')}`).toBe('영상 프로듀서가');
        expect(`비즈니스 전략가${subjectParticle('비즈니스 전략가')}`).toBe('비즈니스 전략가가');
        expect(`법률 전문${subjectParticle('법률 전문')}`).toBe('법률 전문이');
    });

    it('목적격·보조사·도구격', () => {
        expect(objectParticle('스킬')).toBe('을');
        expect(objectParticle('에이전트')).toBe('를');
        expect(topicParticle('작업')).toBe('은');
        expect(topicParticle('세션')).toBe('은');
        expect(topicParticle('메모리')).toBe('는');
        expect(instrumentalParticle('파일')).toBe('로');   // ㄹ 받침
        expect(instrumentalParticle('문서')).toBe('로');
        expect(instrumentalParticle('확장')).toBe('으로');
    });
});
