import { isEmptyTurn, pushStuckSignature } from './turn-guards';

describe('isEmptyTurn', () => {
    it('본문도 도구 호출도 없으면 빈 응답이다', () => {
        expect(isEmptyTurn({ content: '' })).toBe(true);
        expect(isEmptyTurn({ content: '  \n ' })).toBe(true);
        expect(isEmptyTurn({ content: null as unknown as string, tool_calls: [] })).toBe(true);
    });

    it('본문이나 도구 호출이 있으면 빈 응답이 아니다', () => {
        expect(isEmptyTurn({ content: '완료했습니다.' })).toBe(false);
        expect(isEmptyTurn({ content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'bash', arguments: {} } }] })).toBe(false);
    });
});

describe('pushStuckSignature — 같은 응답이 임계 횟수만큼 연속되는지', () => {
    const turn = (c: string) => ({ content: c });

    it('임계에 닿기 전에는 거짓, 같은 응답이 임계만큼 이어지면 참', () => {
        const sigs: string[] = [];
        expect(pushStuckSignature(sigs, turn('a'), 3)).toBe(false);
        expect(pushStuckSignature(sigs, turn('a'), 3)).toBe(false);
        expect(pushStuckSignature(sigs, turn('a'), 3)).toBe(true);
    });

    it('도중에 다른 응답이 끼면 다시 센다', () => {
        const sigs: string[] = [];
        pushStuckSignature(sigs, turn('a'), 3);
        pushStuckSignature(sigs, turn('b'), 3);
        expect(pushStuckSignature(sigs, turn('a'), 3)).toBe(false);
        expect(sigs).toHaveLength(3);
    });

    it('도구 호출의 이름·인자가 다르면 다른 응답이다', () => {
        const sigs: string[] = [];
        const call = (cmd: string) => ({ content: '', tool_calls: [{ id: 'x', type: 'function' as const, function: { name: 'bash', arguments: { command: cmd } } }] });
        pushStuckSignature(sigs, call('ls'), 2);
        expect(pushStuckSignature(sigs, call('pwd'), 2)).toBe(false);
        expect(pushStuckSignature(sigs, call('pwd'), 2)).toBe(true);
    });
});
