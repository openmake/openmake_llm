/**
 * 반출 관문(하네스 P0-2) — 로컬 실행기·민감도 기준 판정과, 내부 전용에서 남기는 도구 판정.
 */
jest.mock('../local-bridge', () => ({ LOCAL_BRIDGE: { ENABLED: true } }));

import { decideEgress, sendsDataOutside, allowedWhenInternalOnly, EGRESS_POLICY } from '../egress-policy';

describe('decideEgress', () => {
    it('기본 기준(off)에선 민감 자료여도 내부 전용이 아니다 — 등급은 매긴다(관측용)', () => {
        expect(EGRESS_POLICY.INTERNAL_ONLY_SENSITIVITY).toBe('off');
        const d = decideEgress({ texts: ['[대외비] 요약'] });
        expect(d).toMatchObject({ internalOnly: false, reason: null, sensitivity: 'confidential' });
    });

    it('로컬 실행기는 민감도와 무관하게 내부 전용(종전 규칙)', () => {
        expect(decideEgress({ executor: 'local', texts: ['안녕'] }, 'off')).toMatchObject({ internalOnly: true, reason: 'local_executor' });
    });

    it('기준 confidential — confidential 이상이면 내부 전용', () => {
        expect(decideEgress({ texts: ['[대외비] 요약'] }, 'confidential')).toMatchObject({ internalOnly: true, reason: 'sensitivity', matched: ['marking_ko'] });
        expect(decideEgress({ texts: ['날씨'] }, 'confidential').internalOnly).toBe(false);
    });

    it('기준 restricted — confidential 은 통과, restricted 만 내부 전용', () => {
        expect(decideEgress({ texts: ['[대외비] 요약'] }, 'restricted').internalOnly).toBe(false);
        expect(decideEgress({ texts: ['token sk-abcdefghijklmnop1234'] }, 'restricted').internalOnly).toBe(true);
    });
});

describe('sendsDataOutside · allowedWhenInternalOnly', () => {
    it('외부 MCP·표 밖 내장 도구·browser 는 밖으로 보낸다', () => {
        expect(sendsDataOutside('github::create_issue')).toBe(true);
        expect(sendsDataOutside('web_search')).toBe(true);
        expect(sendsDataOutside('browser')).toBe(true);
    });

    it('샌드박스 파일·셸·제어 도구는 밖으로 보내지 않는다', () => {
        expect(sendsDataOutside('bash', { command: 'ls' })).toBe(false);
        expect(sendsDataOutside('file_ops', { op: 'write' })).toBe(false);
        expect(sendsDataOutside('ask_human')).toBe(false);
    });

    it('허용 목록(load_skill)은 내부 전용에서도 남긴다', () => {
        expect(allowedWhenInternalOnly('load_skill')).toBe(true);
        expect(allowedWhenInternalOnly('web_search')).toBe(false);
        expect(allowedWhenInternalOnly('grep_code')).toBe(true);
    });
});
