/**
 * 응답 후처리 파이프라인 테스트 (2026-08-02).
 *
 * 계약: null=변경 없음 / 순차 적용 / 예외를 삼키고 원문 유지(fail-open).
 * fail-open 을 개별 프로세서가 아니라 파이프라인이 보장하는지가 핵심이다 —
 * 후처리 실패가 본 응답을 죽이면 안 된다.
 */
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { runResultProcessors, type ResultProcessor } from '../result-pipeline';

const upper: ResultProcessor = { id: 'upper', process: async (c) => c.toUpperCase() };
const noop: ResultProcessor = { id: 'noop', process: async () => null };
const boom: ResultProcessor = { id: 'boom', process: async () => { throw new Error('실패'); } };
const suffix: ResultProcessor = { id: 'suffix', process: async (c) => `${c}!` };

describe('runResultProcessors', () => {
    it('배열 순서대로 적용하고 앞 결과가 다음 입력이 된다', async () => {
        const r = await runResultProcessors('ab', {}, [upper, suffix]);
        expect(r.content).toBe('AB!');
        expect(r.applied).toEqual(['upper', 'suffix']);
    });

    it('null 을 돌려주면 변경 없음으로 보고 applied 에 넣지 않는다', async () => {
        const r = await runResultProcessors('ab', {}, [noop]);
        expect(r.content).toBe('ab');
        expect(r.applied).toEqual([]);
    });

    it('프로세서가 예외를 던져도 원문으로 계속한다 (fail-open)', async () => {
        const r = await runResultProcessors('ab', {}, [boom, suffix]);
        expect(r.content).toBe('ab!');       // boom 은 무시되고 suffix 는 적용
        expect(r.applied).toEqual(['suffix']);
    });

    it('결과가 입력과 같으면 적용으로 세지 않는다', async () => {
        const same: ResultProcessor = { id: 'same', process: async (c) => c };
        const r = await runResultProcessors('ab', {}, [same]);
        expect(r.applied).toEqual([]);
    });

    it('프로세서가 없으면 원문을 그대로 돌려준다', async () => {
        const r = await runResultProcessors('ab', {}, []);
        expect(r.content).toBe('ab');
        expect(r.applied).toEqual([]);
    });

    it('ctx 를 각 프로세서에 전달한다', async () => {
        const seen: unknown[] = [];
        const spy: ResultProcessor = { id: 'spy', process: async (_c, ctx) => { seen.push(ctx); return null; } };
        await runResultProcessors('ab', { langCode: 'ko', userId: 'u1' }, [spy]);
        expect(seen[0]).toEqual({ langCode: 'ko', userId: 'u1' });
    });
});
