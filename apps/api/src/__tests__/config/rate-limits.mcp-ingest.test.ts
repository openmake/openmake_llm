/**
 * RL_MCP_INGEST — Phase 4 rate limit config.
 */
import { RL_MCP_INGEST } from '../../config/rate-limits';

describe('RL_MCP_INGEST config', () => {
    test('windowMs 가 32-bit signed int 한계 미만 (express-rate-limit MemoryStore 제약)', () => {
        const SAFE = 2_147_483_647;
        expect(RL_MCP_INGEST.windowMs).toBeLessThan(SAFE);
        expect(RL_MCP_INGEST.windowMs).toBeGreaterThan(0);
    });

    test('windowMs 가 1시간 (3,600,000ms)', () => {
        expect(RL_MCP_INGEST.windowMs).toBe(60 * 60 * 1000);
    });

    test('역할별 한도 정의 (user / admin)', () => {
        expect(RL_MCP_INGEST.limits).toEqual(
            expect.objectContaining({
                user: expect.any(Number),
                admin: expect.any(Number),
            })
        );
    });

    test('각 역할 한도가 양수', () => {
        const { user, admin } = RL_MCP_INGEST.limits;
        expect(user).toBeGreaterThan(0);
        expect(admin).toBeGreaterThan(0);
    });
});
