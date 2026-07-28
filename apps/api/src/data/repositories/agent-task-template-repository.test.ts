import { instantiateGoal } from './agent-task-template-repository';

describe('instantiateGoal', () => {
    const defs = [
        { name: 'city', default: '서울' },
        { name: 'topic', description: '주제' },
    ];
    it('값 제공 시 치환', () => {
        expect(instantiateGoal('{{city}}의 {{topic}} 요약', defs, { city: '부산', topic: '날씨' }))
            .toBe('부산의 날씨 요약');
    });
    it('값 미제공 시 default, default 없으면 빈 문자열', () => {
        expect(instantiateGoal('{{city}}의 {{topic}} 요약', defs, {})).toBe('서울의  요약');
    });
    it('미정의 {{...}} 는 그대로(오탈자 가시화)', () => {
        expect(instantiateGoal('{{unknown}} 유지', defs, {})).toBe('{{unknown}} 유지');
    });
    it('동일 파라미터 다회 등장 전부 치환', () => {
        expect(instantiateGoal('{{city}} {{city}}', defs, { city: 'X' })).toBe('X X');
    });
    it('params 없으면 원문 유지', () => {
        expect(instantiateGoal('그대로 {{a}}', null, { a: 'x' })).toBe('그대로 {{a}}');
    });
});
