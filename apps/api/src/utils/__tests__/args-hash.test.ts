/**
 * 도구 인자 해시(utils/args-hash) — 승인 저장소의 hashApprovalArgs 와 같은 알고리즘·같은 출력.
 */
import { canonicalJson, hashToolArgs } from '../args-hash';
import { hashApprovalArgs } from '../../data/repositories/agent-task-approval-repository';

describe('hashToolArgs', () => {
    it('키 순서만 다른 객체는 같은 해시다(중첩 포함)', () => {
        expect(hashToolArgs({ a: 1, b: { x: 1, y: 2 } })).toBe(hashToolArgs({ b: { y: 2, x: 1 }, a: 1 }));
    });

    it('undefined 값인 키는 무시한다', () => {
        expect(hashToolArgs({ a: 1, b: undefined })).toBe(hashToolArgs({ a: 1 }));
        expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    });

    it('배열 순서는 구분한다', () => {
        expect(hashToolArgs({ a: [1, 2] })).not.toBe(hashToolArgs({ a: [2, 1] }));
    });

    it('빈 객체와 undefined 입력은 {} 의 해시다', () => {
        const empty = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
        expect(hashToolArgs({})).toBe(empty);
        expect(hashToolArgs(undefined)).toBe(empty);
    });

    it('승인 저장소 hashApprovalArgs 와 같은 출력이다(기존 승인 키 호환)', () => {
        const fixture = { a: 1, b: { x: 1, y: [1, { p: 1, q: 2 }] } };
        expect(hashToolArgs(fixture)).toBe('fac8e2ac893046af46bc991326fed0d54cbef894fb471f49690b263d48cdd300');
        expect(hashApprovalArgs(fixture)).toBe(hashToolArgs(fixture));
    });
});
