/** capability 키 정책 — 문서 색인 임베딩만 행위자 BYOK, 나머지는 배정 출처 기준(종전) */
import { CAPABILITIES, CAPABILITY_KEY_POLICY, capabilityKeyPolicy } from '../capabilities';

describe('capabilityKeyPolicy', () => {
    it('text.embed 는 actor-byok', () => {
        expect(capabilityKeyPolicy('text.embed')).toBe('actor-byok');
    });

    it('그 밖의 capability 는 assignment-scope(종전)', () => {
        for (const c of CAPABILITIES.filter((x) => x !== 'text.embed')) {
            expect(capabilityKeyPolicy(c)).toBe('assignment-scope');
        }
        expect(Object.keys(CAPABILITY_KEY_POLICY)).toEqual(['text.embed']);
    });
});
