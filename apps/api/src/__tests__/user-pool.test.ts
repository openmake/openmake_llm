import { UserMCPPool } from '../mcp/user-pool';

function mkClient(disconnectFn?: jest.Mock) {
    return {
        disconnect: disconnectFn ?? jest.fn().mockResolvedValue(undefined),
        listTools: jest.fn().mockResolvedValue({ tools: [] }),
        callTool: jest.fn().mockResolvedValue({ content: [] }),
    } as never;
}

describe('UserMCPPool', () => {
    test('add 후 get 으로 동일 인스턴스 반환', () => {
        const pool = new UserMCPPool();
        const c = mkClient();
        pool.add('u-1', 's-1', c);
        expect(pool.get('u-1', 's-1')).toBe(c);
    });

    test('다른 사용자는 격리', () => {
        const pool = new UserMCPPool();
        const c1 = mkClient();
        const c2 = mkClient();
        pool.add('u-1', 's-1', c1);
        pool.add('u-2', 's-1', c2);
        expect(pool.get('u-1', 's-1')).toBe(c1);
        expect(pool.get('u-2', 's-1')).toBe(c2);
        expect(pool.get('u-1', 's-x')).toBeUndefined();
    });

    test('remove 후 get 은 undefined', async () => {
        const pool = new UserMCPPool();
        const disc = jest.fn().mockResolvedValue(undefined);
        pool.add('u-1', 's-1', mkClient(disc));
        await pool.remove('u-1', 's-1');
        expect(pool.get('u-1', 's-1')).toBeUndefined();
        expect(disc).toHaveBeenCalledTimes(1);
    });

    test('forUser 는 해당 사용자의 모든 client iterate', () => {
        const pool = new UserMCPPool();
        pool.add('u-1', 's-a', mkClient());
        pool.add('u-1', 's-b', mkClient());
        pool.add('u-2', 's-a', mkClient());
        const ids = [...pool.forUser('u-1')].map(([id]) => id).sort();
        expect(ids).toEqual(['s-a', 's-b']);
    });

    test('closeUser 가 해당 사용자 모든 client disconnect', async () => {
        const pool = new UserMCPPool();
        const d1 = jest.fn().mockResolvedValue(undefined);
        const d2 = jest.fn().mockResolvedValue(undefined);
        pool.add('u-1', 's-a', mkClient(d1));
        pool.add('u-1', 's-b', mkClient(d2));
        pool.add('u-2', 's-a', mkClient());
        await pool.closeUser('u-1');
        expect(d1).toHaveBeenCalledTimes(1);
        expect(d2).toHaveBeenCalledTimes(1);
        expect(pool.get('u-1', 's-a')).toBeUndefined();
        expect(pool.get('u-2', 's-a')).toBeDefined();
    });

    test('closeAll 은 전체 disconnect', async () => {
        const pool = new UserMCPPool();
        const d1 = jest.fn().mockResolvedValue(undefined);
        const d2 = jest.fn().mockResolvedValue(undefined);
        pool.add('u-1', 's-a', mkClient(d1));
        pool.add('u-2', 's-a', mkClient(d2));
        await pool.closeAll();
        expect(d1).toHaveBeenCalled();
        expect(d2).toHaveBeenCalled();
        expect([...pool.userIds()]).toEqual([]);
    });

    test('disconnect 가 실패해도 풀에서는 제거', async () => {
        const pool = new UserMCPPool();
        const disc = jest.fn().mockRejectedValue(new Error('boom'));
        pool.add('u-1', 's-1', mkClient(disc));
        await pool.remove('u-1', 's-1');
        expect(pool.get('u-1', 's-1')).toBeUndefined();
        expect(disc).toHaveBeenCalled();
    });
});
