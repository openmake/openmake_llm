/**
 * WRITE_BATCH_ROWS — 배치 루프의 step 이므로 양의 정수만 받는다(음수면 루프가 끝나지 않는다). 아니면 기본 500.
 */
describe('KNOWLEDGE_RUNTIME.WRITE_BATCH_ROWS', () => {
    const saved = process.env.KNOWLEDGE_WRITE_BATCH_ROWS;
    afterEach(() => {
        if (saved === undefined) delete process.env.KNOWLEDGE_WRITE_BATCH_ROWS;
        else process.env.KNOWLEDGE_WRITE_BATCH_ROWS = saved;
    });

    it('음수 env 는 기본값 500 으로 떨어진다', () => {
        process.env.KNOWLEDGE_WRITE_BATCH_ROWS = '-5';
        jest.isolateModules(() => {
            const { KNOWLEDGE_RUNTIME } = require('../constants') as typeof import('../constants');
            expect(KNOWLEDGE_RUNTIME.WRITE_BATCH_ROWS).toBe(500);
        });
    });
});
