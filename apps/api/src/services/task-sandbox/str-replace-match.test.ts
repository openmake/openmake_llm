import { resolveMissedStrReplace } from './str-replace-match';

describe('str_replace 단계적 매칭', () => {
    it('줄 끝 공백만 다르면 적용한다', () => {
        const r = resolveMissedStrReplace('const a = 1;  \nconst b = 2;\t\nend\n', 'const a = 1;\nconst b = 2;', 'const c = 3;', 'a.ts');
        expect(r.content).toBe('const c = 3;\nend\n');
        expect(r.message).toContain('줄 끝 공백');
        expect(r.message).toContain('1번 줄');
    });

    it('들여쓰기만 다르면 적용하고 새 문자열을 파일의 들여쓰기에 맞춘다', () => {
        const file = 'def f():\n    if x:\n        y()\n    return 1\n';
        const r = resolveMissedStrReplace(file, 'if x:\n    y()', 'if x:\n    z()\n    w()', 'a.py');
        expect(r.content).toBe('def f():\n    if x:\n        z()\n        w()\n    return 1\n');
        expect(r.message).toContain('들여쓰기');
        expect(r.message).toContain('2번 줄');
    });

    it('old_str 의 들여쓰기가 파일보다 깊으면 그만큼 덜어 낸다', () => {
        const r = resolveMissedStrReplace('a()\nb()\n', '    a()', '    c()\n    d()', 'a.py');
        expect(r.content).toBe('c()\nd()\nb()\n');
    });

    it('따옴표 종류만 다르면 줄 중간이어도 적용한다', () => {
        const r = resolveMissedStrReplace('x = say("hi") + 1\n', "say('hi')", "say('bye')", 'a.py');
        expect(r.content).toBe("x = say('bye') + 1\n");
        expect(r.message).toContain('따옴표');
    });

    it('굽은 따옴표로 보낸 old_str 도 맞춘다', () => {
        const r = resolveMissedStrReplace("t('안녕')\n", 't(\u2018안녕\u2019)', "t('잘가')", 'a.ts');
        expect(r.content).toBe("t('잘가')\n");
    });

    it('차이를 무시했을 때 여러 곳에 맞으면 적용하지 않고 줄 번호를 알린다', () => {
        const file = '  foo();\nbar();\n    foo();\n';
        const r = resolveMissedStrReplace(file, 'foo();', 'baz();', 'a.ts');
        expect(r.content).toBeUndefined();
        expect(r.message).toContain('2곳');
        expect(r.message).toContain('1, 3번 줄');
        expect(r.message).toContain('적용하지 않았습니다');
    });

    it('어디에도 맞지 않으면 가장 비슷한 줄을 줄 번호와 함께 보여 준다', () => {
        const file = 'import a from "a";\n\nfunction renderHeader(title) {\n  return title;\n}\n';
        const r = resolveMissedStrReplace(file, 'function renderHeader(titel) {', 'x', 'a.js');
        expect(r.content).toBeUndefined();
        expect(r.message).toContain('3| function renderHeader(title) {');
        expect(r.message).not.toContain('import a');
    });

    it('비슷한 줄이 없으면 종전 고정 안내를 준다', () => {
        const r = resolveMissedStrReplace('alpha\nbeta\n', 'zzzzqqqq', 'x', 'a.txt');
        expect(r.content).toBeUndefined();
        expect(r.message).toContain('command:view');
    });

    it('매칭을 끄면 공백 차이여도 적용하지 않는다(비슷한 줄 안내는 남는다)', () => {
        const r = resolveMissedStrReplace('  foo();\n', 'foo();  ', 'bar();', 'a.ts', false);
        expect(r.content).toBeUndefined();
        expect(r.message).toContain('1|   foo();');
    });

    it('공백뿐인 old_str 는 느슨하게 맞추지 않는다', () => {
        const r = resolveMissedStrReplace('a\n\nb\n', '   ', 'x', 'a.txt');
        expect(r.content).toBeUndefined();
    });
});
