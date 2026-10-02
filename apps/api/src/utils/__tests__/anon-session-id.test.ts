import { isClaimableAnonSessionId } from '../anon-session-id';

describe('isClaimableAnonSessionId', () => {
    it('UUID v4 는 받는다', () => {
        expect(isClaimableAnonSessionId('6c0b9055-dc88-4b22-b38a-4812722ced8e')).toBe(true);
    });
    it('예전 웹 형식(anon-시각-난수)은 받는다', () => {
        expect(isClaimableAnonSessionId('anon-1790721802178-vmumuwi9zjs')).toBe(true);
    });
    it('난수가 없거나 짧은 id·임의 문자열은 받지 않는다', () => {
        for (const v of ['anon-1790721802178', 'anon-1790721802178-abc', 'anon-123-vmumuwi9zjs', '', "' or 1=1 --", '6c0b9055-dc88-1b22-b38a-4812722ced8e']) {
            expect(isClaimableAnonSessionId(v)).toBe(false);
        }
    });
});
