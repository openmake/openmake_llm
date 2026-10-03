/**
 * 절차 스킬 저장 전 구조 검사 — 알 수 없는 액션·빈 단계·빈 본문을 저장하지 않게 한다.
 */
import { findStructureProblems, staticGotoActions } from './procedural-structure';

describe('findStructureProblems', () => {
    it('정상 브라우저 절차는 문제 없음', () => {
        expect(findStructureProblems({ kind: 'browser', actions: [{ type: 'goto', url: 'https://example.com/{{q}}' }, { type: 'fill', selector: '#q', text: '{{q}}' }, { type: 'extractText' }] })).toEqual([]);
    });
    it('액션이 하나도 없으면 문제', () => {
        expect(findStructureProblems({ kind: 'browser', actions: [] })).toHaveLength(1);
    });
    it('알 수 없는 액션 종류를 위치와 함께 알린다', () => {
        const p = findStructureProblems({ kind: 'browser', actions: [{ type: 'goto', url: 'https://example.com' }, { type: 'hover', selector: '#a' }] });
        expect(p).toHaveLength(1);
        expect(p[0]).toContain('actions[1]');
        expect(p[0]).toContain('hover');
    });
    it('빈 단계(객체가 아니거나 type 없음)와 필수 값이 빠진 단계', () => {
        const p = findStructureProblems({ kind: 'browser', actions: [null, {}, { type: 'goto' }, { type: 'click', selector: '  ' }] });
        expect(p).toHaveLength(4);
    });
    it('스크립트 본문이 공백뿐이면 문제', () => {
        expect(findStructureProblems({ kind: 'script', code: '  \n ' })).toHaveLength(1);
        expect(findStructureProblems({ kind: 'script', code: 'echo hi' })).toEqual([]);
    });
});

describe('staticGotoActions', () => {
    it('{{param}} 이 들어간 주소는 저장 때 검사하지 않는다(재생 때 치환 뒤 검사)', () => {
        const actions = [{ type: 'goto', url: 'http://169.254.169.254/' }, { type: 'goto', url: 'https://{{host}}/x' }, { type: 'click', selector: '#a' }];
        expect(staticGotoActions(actions)).toEqual([actions[0]]);
    });
});
