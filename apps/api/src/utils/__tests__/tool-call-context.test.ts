import { runWithToolCallContext, getToolCallIdempotencyKey } from '../tool-call-context';

describe('tool-call-context', () => {
    it('문맥 안에서만 멱등 키가 보인다 — await 를 건너도 유지된다', async () => {
        expect(getToolCallIdempotencyKey()).toBeUndefined();
        const seen = await runWithToolCallContext({ idempotencyKey: 'k1' }, async () => {
            await new Promise((r) => setTimeout(r, 1));
            return getToolCallIdempotencyKey();
        });
        expect(seen).toBe('k1');
        expect(getToolCallIdempotencyKey()).toBeUndefined();
    });
});
