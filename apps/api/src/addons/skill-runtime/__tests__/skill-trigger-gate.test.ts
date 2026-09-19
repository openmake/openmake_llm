import { parseManifestTriggers, matchesSkillTriggers, readMetaTriggers } from '../skill-manager';

describe('parseManifestTriggers', () => {
    it('블록 시퀀스 형태를 파싱한다', () => {
        const yaml = [
            'name: presentation-designer',
            'category: design',
            'triggers:',
            '  - 발표자료',
            '  - "슬라이드"',
            '  - PPT',
            'version: 1.0.3',
        ].join('\n');
        expect(parseManifestTriggers(yaml)).toEqual(['발표자료', '슬라이드', 'PPT']);
    });

    it('인라인 배열 형태를 파싱한다', () => {
        expect(parseManifestTriggers('triggers: [발표자료, 슬라이드]')).toEqual(['발표자료', '슬라이드']);
    });

    it('triggers 미선언이면 빈 배열', () => {
        expect(parseManifestTriggers('name: x\ncategory: design')).toEqual([]);
    });

    it('tool_bindings 등 다른 시퀀스 키를 삼키지 않는다', () => {
        const yaml = ['name: x', 'tool_bindings:', '  - tool_name: "a"', '    mode: required'].join('\n');
        expect(parseManifestTriggers(yaml)).toEqual([]);
    });
});

describe('matchesSkillTriggers', () => {
    const triggers = ['발표자료', '슬라이드', 'PPT'];

    it('질의가 트리거를 포함하면 주입한다', () => {
        expect(matchesSkillTriggers(triggers, '이 자료로 발표자료 만들어줘')).toBe(true);
        expect(matchesSkillTriggers(triggers, 'ppt 로 정리해줘')).toBe(true); // 대소문자 무관
    });

    it('무관한 질의에는 주입하지 않는다', () => {
        expect(matchesSkillTriggers(triggers, 'AWS, Azure, GCP의 한국 리전과 가격 모델을 표로 정리해줘')).toBe(false);
    });

    it('triggers 미선언 스킬은 항상 주입한다 (기존 동작 유지)', () => {
        expect(matchesSkillTriggers([], '아무 질의')).toBe(true);
    });

    it('질의를 알 수 없으면 게이트하지 않는다 (판단 근거 부재)', () => {
        expect(matchesSkillTriggers(triggers, undefined)).toBe(true);
        expect(matchesSkillTriggers(triggers, '   ')).toBe(true);
    });
});

describe('readMetaTriggers', () => {
    it('문자열 배열만 추려낸다', () => {
        expect(readMetaTriggers({ triggers: ['a', '', 3, ' b '] })).toEqual(['a', 'b']);
    });

    it('triggers 가 없거나 배열이 아니면 빈 배열', () => {
        expect(readMetaTriggers({})).toEqual([]);
        expect(readMetaTriggers({ triggers: 'a,b' })).toEqual([]);
        expect(readMetaTriggers(undefined)).toEqual([]);
    });
});
