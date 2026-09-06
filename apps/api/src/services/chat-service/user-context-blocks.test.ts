/**
 * 메모리 주입 블록 — 사용자 격리(요청 userId 의 행만 프롬프트에 도달)·토큰 cap·touchAccessed·
 * 토글 OFF/guest 미조회·조회 실패 graceful. 저장소 레벨 격리 테스트(user-memory-repository.test)와
 * 별개로 **프롬프트에 닿는 마지막 경로**를 고정한다(Agent Memory Atlas 지적, 2026-09-07).
 */
const repoMock = { listActiveByUser: jest.fn(), touchAccessed: jest.fn().mockResolvedValue(undefined) };
jest.mock('../../data/repositories/user-memory-repository', () => ({
    UserMemoryRepository: jest.fn().mockImplementation(() => repoMock),
}));
jest.mock('../../data/repositories/user-repository', () => ({
    UserRepository: jest.fn().mockImplementation(() => ({ getCustomInstructions: jest.fn().mockResolvedValue('') })),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { buildUserMemoryBlock, buildUserContextBlocks } from './user-context-blocks';
import { USER_CONTEXT_LIMITS } from '../../config/runtime-limits';

const ROWS: Record<string, Array<{ id: string; content: string }>> = {
    u1: [{ id: 'a1', content: '사용자는 TypeScript 를 선호한다' }],
    u2: [{ id: 'b1', content: '사용자의 이름은 김영희다' }],
};

beforeEach(() => {
    repoMock.listActiveByUser.mockReset();
    repoMock.touchAccessed.mockClear();
    repoMock.listActiveByUser.mockImplementation(async (userId: string) => ROWS[userId] ?? []);
});

describe('buildUserMemoryBlock — 격리', () => {
    it('요청 userId 로만 조회하고 그 사용자의 행만 블록에 싣는다', async () => {
        const b1 = await buildUserMemoryBlock('u1');
        expect(repoMock.listActiveByUser).toHaveBeenCalledWith('u1', expect.any(Number));
        expect(b1).toContain('TypeScript');
        expect(b1).not.toContain('김영희');

        const b2 = await buildUserMemoryBlock('u2');
        expect(repoMock.listActiveByUser).toHaveBeenLastCalledWith('u2', expect.any(Number));
        expect(b2).toContain('김영희');
        expect(b2).not.toContain('TypeScript');
    });

    it('주입한 행만 touchAccessed 한다', async () => {
        await buildUserMemoryBlock('u1');
        expect(repoMock.touchAccessed).toHaveBeenCalledWith(['a1']);
    });

    it('행이 없으면 빈 문자열이고 touchAccessed 도 없다', async () => {
        expect(await buildUserMemoryBlock('nobody')).toBe('');
        expect(repoMock.touchAccessed).not.toHaveBeenCalled();
    });

    it('토큰 cap 초과 시 앞(최신)부터 남기고 나머지는 주입·touch 모두 제외', async () => {
        // 300자 라틴 × 40행 — 어떤 가중치로도 MAX_MEMORY_TOKENS(2000) 를 넘긴다.
        const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, content: `row${i} ` + 'x'.repeat(300) }));
        repoMock.listActiveByUser.mockResolvedValue(many);
        const block = await buildUserMemoryBlock('u1');
        const touched = repoMock.touchAccessed.mock.calls[0][0] as string[];
        expect(touched.length).toBeGreaterThan(0);
        expect(touched.length).toBeLessThan(many.length);
        expect(block).toContain('row0 ');
        expect(block).not.toContain('row39 ');
        expect(USER_CONTEXT_LIMITS.MAX_MEMORY_TOKENS).toBeGreaterThan(0);
    });

    it('조회 실패는 빈 블록으로 graceful', async () => {
        repoMock.listActiveByUser.mockRejectedValue(new Error('db down'));
        expect(await buildUserMemoryBlock('u1')).toBe('');
    });
});

describe('buildUserContextBlocks — 토글·guest', () => {
    it('includeMemory=false 면 메모리를 조회조차 하지 않는다', async () => {
        const r = await buildUserContextBlocks('u1', false);
        expect(r.memoryBlock).toBe('');
        expect(repoMock.listActiveByUser).not.toHaveBeenCalled();
    });

    it('guest·미인증은 두 블록 모두 빈 문자열, 조회 없음', async () => {
        for (const uid of ['guest', undefined]) {
            const r = await buildUserContextBlocks(uid, true);
            expect(r).toEqual({ memoryBlock: '', customInstructionsBlock: '' });
        }
        expect(repoMock.listActiveByUser).not.toHaveBeenCalled();
    });

    it('includeMemory=true 면 메모리 블록이 실린다', async () => {
        const r = await buildUserContextBlocks('u1', true);
        expect(r.memoryBlock).toContain('TypeScript');
    });
});
