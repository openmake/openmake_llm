/**
 * Procedural Skill 순수 함수 유닛 테스트 (#1).
 * DB 를 타는 save/load/find 는 통합 검증(라이브)로 다루고, 여기선 결정적 순수 로직만.
 */
import { applyParams, deepApplyParams, parseSpec, findPlaintextSecrets, PROCEDURAL_CATEGORY, type ProceduralSpec } from './procedural-skill';

describe('procedural-skill pure helpers', () => {
    describe('applyParams', () => {
        it('{{name}} 치환', () => {
            expect(applyParams('도시={{city}}', { city: '부산' })).toBe('도시=부산');
        });
        it('공백 허용 + 다중 치환', () => {
            expect(applyParams('{{ a }}-{{b}}', { a: '1', b: '2' })).toBe('1-2');
        });
        it('미정의 키는 원문 보존', () => {
            expect(applyParams('{{x}}/{{y}}', { x: 'X' })).toBe('X/{{y}}');
        });
        it('플레이스홀더 없으면 그대로', () => {
            expect(applyParams('no placeholder', { a: '1' })).toBe('no placeholder');
        });
    });

    describe('deepApplyParams', () => {
        it('중첩 객체/배열의 문자열 리프만 치환(구조 보존)', () => {
            const input = { url: 'https://x/{{q}}', steps: [{ text: '{{q}}' }, 3, true] };
            const out = deepApplyParams(input, { q: 'kw' });
            expect(out).toEqual({ url: 'https://x/kw', steps: [{ text: 'kw' }, 3, true] });
        });
        it('따옴표 포함 값도 JSON 파손 없이 치환', () => {
            const out = deepApplyParams([{ fill: '{{v}}' }], { v: 'a"b' });
            expect(out).toEqual([{ fill: 'a"b' }]);
        });
    });

    describe('parseSpec', () => {
        it('유효 browser 스펙', () => {
            const spec: ProceduralSpec = { kind: 'browser', goal: 'g', actions: [{ type: 'goto', url: 'u' }] };
            expect(parseSpec(JSON.stringify(spec))).toEqual(spec);
        });
        it('유효 script 스펙', () => {
            const spec: ProceduralSpec = { kind: 'script', goal: 'g', lang: 'python', code: 'print(1)' };
            expect(parseSpec(JSON.stringify(spec))).toEqual(spec);
        });
        it('browser 인데 actions 없으면 null', () => {
            expect(parseSpec(JSON.stringify({ kind: 'browser', goal: 'g' }))).toBeNull();
        });
        it('script 인데 code 없으면 null', () => {
            expect(parseSpec(JSON.stringify({ kind: 'script', goal: 'g' }))).toBeNull();
        });
        it('알 수 없는 kind 는 null', () => {
            expect(parseSpec(JSON.stringify({ kind: 'os', goal: 'g' }))).toBeNull();
        });
        it('깨진 JSON 은 null', () => {
            expect(parseSpec('{not json')).toBeNull();
        });
    });

    it('PROCEDURAL_CATEGORY 상수', () => {
        expect(PROCEDURAL_CATEGORY).toBe('procedural');
    });

    // resolveProceduralSpec 의 DB 무관 로직은 라이브에서 검증(fuzzy 매칭 실측). 여기선 순수부만.
});

describe('findPlaintextSecrets — 저장 전에 평문 비밀 값을 찾는다', () => {
    it('비밀번호 입력란에 넣은 평문을 찾는다', () => {
        const hits = findPlaintextSecrets({ kind: 'browser', goal: 'g', actions: [
            { type: 'goto', url: 'https://example.com/login' },
            { type: 'fill', selector: 'input[name=email]', text: 'a@example.com' },
            { type: 'fill', selector: 'input[type=password]', text: 'hunter2!' },
        ] });
        expect(hits).toHaveLength(1);
        expect(hits[0]).toContain('input[type=password]');
        expect(hits[0]).not.toContain('hunter2!');
    });

    it('{{param}} 으로 일반화한 값은 통과시킨다', () => {
        expect(findPlaintextSecrets({ kind: 'browser', goal: 'g', actions: [
            { type: 'fill', selector: '#password', text: '{{password}}' },
            { type: 'smartFill', label: '비밀번호', text: '{{ pw }}' },
        ] })).toEqual([]);
    });

    it('라벨로 찾는 입력(smartFill)도 본다', () => {
        expect(findPlaintextSecrets({ kind: 'browser', goal: 'g', actions: [
            { type: 'smartFill', label: 'API Token', text: 'abcd1234' },
        ] })).toHaveLength(1);
    });

    it('스크립트에 박힌 키·토큰을 찾는다', () => {
        expect(findPlaintextSecrets({ kind: 'script', goal: 'g', lang: 'bash',
            code: 'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://api.example.com' })).toHaveLength(1);
        expect(findPlaintextSecrets({ kind: 'script', goal: 'g', lang: 'bash', code: 'echo $((1+1))' })).toEqual([]);
    });
});
