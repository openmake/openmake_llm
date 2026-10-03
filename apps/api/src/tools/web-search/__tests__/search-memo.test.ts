/**
 * 검색 결과 메모 — 같은 사용자·같은 질의의 웹 검색을 짧은 시간 기억하고, 동시에 들어온 같은 질의는 한 번으로 합친다.
 * 종전에는 캐시가 없어 같은 질의가 올 때마다 모든 공급자를 다시 불렀다.
 */
import { SearchMemo, searchMemoKey } from '../search-memo';

const user = { userId: 7, role: 'user' as const, orgId: 'org-a' };

describe('searchMemoKey', () => {
    it('대소문자·공백 차이는 같은 키, 사용자·조직이 다르면 다른 키다', () => {
        const base = searchMemoKey(user, '  2026   환율 전망 ');
        expect(searchMemoKey(user, '2026 환율 전망')).toBe(base);
        expect(searchMemoKey({ ...user, userId: '7' }, '2026 환율 전망')).toBe(base);
        expect(searchMemoKey(user, 'USD KRW')).toBe(searchMemoKey(user, 'usd krw'));
        expect(searchMemoKey({ ...user, userId: 8 }, '2026 환율 전망')).not.toBe(base);
        expect(searchMemoKey({ ...user, orgId: 'org-b' }, '2026 환율 전망')).not.toBe(base);
        expect(searchMemoKey({ ...user, orgId: undefined }, '2026 환율 전망')).not.toBe(base);
    });

    it('사용자를 알 수 없으면 키가 없다(기억하지 않는다)', () => {
        expect(searchMemoKey(undefined, 'q')).toBeNull();
    });
});

describe('SearchMemo', () => {
    let now = 1_000_000;
    const memo = () => new SearchMemo<string[]>({ ttlMs: 1000, maxEntries: 2, now: () => now });
    beforeEach(() => { now = 1_000_000; });

    it('유효 시간 안의 같은 키는 다시 부르지 않고, 지나면 다시 부른다', async () => {
        const m = memo();
        const fetch = jest.fn(async () => ['a']);
        expect(await m.run('k', fetch)).toEqual(['a']);
        now += 999;
        expect(await m.run('k', fetch)).toEqual(['a']);
        expect(fetch).toHaveBeenCalledTimes(1);
        now += 2;
        await m.run('k', fetch);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('동시에 들어온 같은 키는 한 번의 호출로 합친다', async () => {
        const m = memo();
        let release!: (v: string[]) => void;
        const fetch = jest.fn(() => new Promise<string[]>((r) => { release = r; }));
        const both = Promise.all([m.run('k', fetch), m.run('k', fetch)]);
        release(['x']);
        expect(await both).toEqual([['x'], ['x']]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('돌려준 값을 호출자가 바꿔도 기억된 값은 그대로다', async () => {
        const m = memo();
        const first = await m.run('k', async () => ['a']);
        first.push('mutated');
        expect(await m.run('k', async () => ['other'])).toEqual(['a']);
    });

    it('빈 결과와 실패는 기억하지 않는다', async () => {
        const m = memo();
        const empty = jest.fn(async () => [] as string[]);
        await m.run('e', empty);
        await m.run('e', empty);
        expect(empty).toHaveBeenCalledTimes(2);

        const failing = jest.fn(async (): Promise<string[]> => { throw new Error('down'); });
        await expect(m.run('f', failing)).rejects.toThrow('down');
        await expect(m.run('f', failing)).rejects.toThrow('down');
        expect(failing).toHaveBeenCalledTimes(2);
    });

    it('크기 상한을 넘으면 가장 오래된 것부터 버린다', async () => {
        const m = memo();
        await m.run('a', async () => ['a']);
        await m.run('b', async () => ['b']);
        await m.run('c', async () => ['c']);
        expect(m.size).toBe(2);
        const again = jest.fn(async () => ['a2']);
        expect(await m.run('a', again)).toEqual(['a2']);
        expect(again).toHaveBeenCalledTimes(1);
        const kept = jest.fn(async () => ['c2']);
        expect(await m.run('c', kept)).toEqual(['c']);
        expect(kept).not.toHaveBeenCalled();
    });
});
