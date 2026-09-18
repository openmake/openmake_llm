/**
 * 요청 지문(F24.2) — 같은 입력 같은 해시, 가변 블록 변화는 정적 지문을 바꾸지 않음, 도구 순서 무관.
 */
import { fingerprintPrompt, fingerprintTools, promptBlockNames, sha256 } from '../prompt-fingerprint';

describe('fingerprintPrompt', () => {
    it('같은 입력은 같은 지문, 전체 지문은 조립 문자열(\\n\\n)의 sha256', () => {
        const a = fingerprintPrompt(['GUARD', 'ART'], ['DATE', 'LANG']);
        expect(a).toEqual(fingerprintPrompt(['GUARD', 'ART'], ['DATE', 'LANG']));
        expect(a.fullHash).toBe(sha256('GUARD\n\nART\n\nDATE\n\nLANG'));
        expect(a.staticText).toBe('GUARD\n\nART');
    });
    it('가변 블록이 바뀌어도 정적 지문은 그대로(prefix cache 관측 기준)', () => {
        const a = fingerprintPrompt(['GUARD'], ['memory A']);
        const b = fingerprintPrompt(['GUARD'], ['memory B']);
        expect(a.staticHash).toBe(b.staticHash);
        expect(a.fullHash).not.toBe(b.fullHash);
    });
});

describe('fingerprintTools', () => {
    it('노출 순서가 달라도 같은 도구 집합이면 같은 지문, 스키마가 바뀌면 달라진다', () => {
        const x = { function: { name: 'web_search', parameters: { type: 'object' } } };
        const y = { function: { name: 'agent_task_list', parameters: {} } };
        expect(fingerprintTools([x, y]).hash).toBe(fingerprintTools([y, x]).hash);
        expect(fingerprintTools([x, y]).names).toEqual(['agent_task_list', 'web_search']);
        expect(fingerprintTools([{ function: { name: 'web_search', parameters: { type: 'object', required: ['q'] } } }, y]).hash).not.toBe(fingerprintTools([x, y]).hash);
    });
});

describe('promptBlockNames', () => {
    it('실린 블록 이름만(내용 없음), default 스타일은 제외', () => {
        expect(promptBlockNames({ style: 'default', artifactGuideBlock: 'x', memoryBlock: 'm' }, { webSearch: true, integrations: [] })).toEqual(['artifact', 'memory', 'webSearch']);
        expect(promptBlockNames({}, { integrations: ['kakao-map'] })).toEqual(['kakao-map']);
        expect(promptBlockNames({ style: 'concise' }, {})).toEqual(['style']);
    });
});
