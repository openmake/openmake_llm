/**
 * 작업 생성 중복 방지 — 더블 클릭·네트워크 재전송으로 같은 에이전트 작업이 두 번 만들어져 두 번 실행되던 문제.
 * 클라이언트가 보낸 Idempotency-Key 를 사용자 단위로 기억해, 같은 키의 재요청은 새로 만들지 않고 처음 만든 작업을 돌려준다.
 */
import { EventEmitter } from 'events';
import {
    resolveDuplicateCreate, normalizedCreateKey, claimDelegatedTask, releaseDelegatedTask, resetCreateIdempotencyForTest,
} from '../create-idempotency';

function fakeRes(): EventEmitter & { statusCode: number } {
    return Object.assign(new EventEmitter(), { statusCode: 200 });
}
const KEY = '3f2b8c1e-0000-4000-8000-aaaaaaaaaaaa';

beforeEach(() => resetCreateIdempotencyForTest());

describe('resolveDuplicateCreate', () => {
    it('키가 없거나 형식이 틀리면 멱등 없이 진행한다', async () => {
        const load = jest.fn();
        expect(await resolveDuplicateCreate({ userId: 'u1', rawKey: undefined, taskId: 't1', res: fakeRes(), loadTask: load })).toBeNull();
        expect(await resolveDuplicateCreate({ userId: 'u1', rawKey: 'short', taskId: 't2', res: fakeRes(), loadTask: load })).toBeNull();
        expect(await resolveDuplicateCreate({ userId: 'u1', rawKey: 'short', taskId: 't3', res: fakeRes(), loadTask: load })).toBeNull();
        expect(load).not.toHaveBeenCalled();
    });

    it('같은 키의 재요청은 처음 만든 작업을 돌려준다', async () => {
        const first = await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't1', res: fakeRes(), loadTask: jest.fn() });
        expect(first).toBeNull();
        const task = { id: 't1', status: 'pending' };
        const again = await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't2', res: fakeRes(), loadTask: async (id) => (id === 't1' ? task : null) });
        expect(again).toEqual({ kind: 'duplicate', task });
    });

    it('동시에 온 두 요청 — 첫 요청이 아직 저장 전이면 두 번째는 처리 중으로 답한다(새로 만들지 않는다)', async () => {
        const a = resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't1', res: fakeRes(), loadTask: jest.fn() });
        const b = resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't2', res: fakeRes(), loadTask: async () => null });
        expect(await a).toBeNull();
        expect(await b).toEqual({ kind: 'in_flight', taskId: 't1' });
    });

    it('사용자가 다르면 같은 키라도 별개다', async () => {
        await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't1', res: fakeRes(), loadTask: jest.fn() });
        expect(await resolveDuplicateCreate({ userId: 'u2', rawKey: KEY, taskId: 't2', res: fakeRes(), loadTask: jest.fn() })).toBeNull();
    });

    it('생성이 실패(4xx·5xx)로 끝나면 키를 풀어 재시도가 새로 만들 수 있게 한다', async () => {
        const res = fakeRes();
        await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't1', res, loadTask: jest.fn() });
        res.statusCode = 400;
        res.emit('finish');
        expect(await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't2', res: fakeRes(), loadTask: jest.fn() })).toBeNull();
    });

    it('응답 없이 연결만 끊긴 경우(close)는 실패로 단정하지 않는다 — 저장 중일 수 있어 키를 유지한다', async () => {
        const res = fakeRes();
        await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't1', res, loadTask: jest.fn() });
        res.emit('close'); // finish 없이 종료 — 작업 행이 없다
        const again = await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't2', res: fakeRes(), loadTask: async () => null });
        expect(again).toEqual({ kind: 'in_flight', taskId: 't1' });
    });

    it('성공(201)으로 끝나면 키를 유지한다', async () => {
        const res = fakeRes();
        await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't1', res, loadTask: jest.fn() });
        res.statusCode = 201;
        res.emit('finish');
        const again = await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't2', res: fakeRes(), loadTask: async () => ({ id: 't1' }) });
        expect(again).toEqual({ kind: 'duplicate', task: { id: 't1' } });
    });
});

describe('resolveDuplicateCreate — DB 에 남은 키(재시작·다른 서버)', () => {
    it('메모리에는 없지만 DB 에 같은 키의 작업이 있으면 그 작업을 돌려준다', async () => {
        const stored = { id: 'old', status: 'completed' };
        const r = await resolveDuplicateCreate({
            userId: 'u1', rawKey: KEY, taskId: 't-new', res: fakeRes(), loadTask: jest.fn(),
            findByKey: async (userId, key) => (userId === 'u1' && key === KEY ? stored : null),
        });
        expect(r).toEqual({ kind: 'duplicate', task: stored });
    });

    it('DB 에서 찾은 뒤에는 같은 키의 다음 요청도 그 작업으로 답한다(새 id 를 기억하지 않는다)', async () => {
        const stored = { id: 'old' };
        await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't-new', res: fakeRes(), loadTask: jest.fn(), findByKey: async () => stored });
        const again = await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't-3', res: fakeRes(), loadTask: async (id) => (id === 'old' ? stored : null) });
        expect(again).toEqual({ kind: 'duplicate', task: stored });
    });

    it('DB 에도 없으면 그대로 생성 진행', async () => {
        const find = jest.fn(async () => null);
        expect(await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't1', res: fakeRes(), loadTask: jest.fn(), findByKey: find })).toBeNull();
        expect(find).toHaveBeenCalledWith('u1', KEY);
    });

    it('DB 조회 중에 같은 키의 요청이 또 와도 새로 만들지 않는다(조회 전에 먼저 기억)', async () => {
        let release: (v: null) => void = () => undefined;
        const slow = new Promise<null>((r) => { release = r; });
        const a = resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't1', res: fakeRes(), loadTask: jest.fn(), findByKey: () => slow });
        const b = await resolveDuplicateCreate({ userId: 'u1', rawKey: KEY, taskId: 't2', res: fakeRes(), loadTask: async () => null, findByKey: async () => null });
        expect(b).toEqual({ kind: 'in_flight', taskId: 't1' });
        release(null);
        expect(await a).toBeNull();
    });

    it('키 형식이 틀리면 DB 를 조회하지 않는다', async () => {
        const find = jest.fn();
        await resolveDuplicateCreate({ userId: 'u1', rawKey: 'bad', taskId: 't1', res: fakeRes(), loadTask: jest.fn(), findByKey: find });
        expect(find).not.toHaveBeenCalled();
    });
});

describe('normalizedCreateKey', () => {
    it('형식이 맞는 키만 돌려준다 — 저장·조회에 같은 값을 쓴다', () => {
        expect(normalizedCreateKey(` ${KEY} `)).toBe(KEY);
        expect(normalizedCreateKey('short')).toBeUndefined();
        expect(normalizedCreateKey(undefined)).toBeUndefined();
    });
});

describe('claimDelegatedTask — 채팅에서 위임한 작업', () => {
    it('같은 사용자가 같은 목표를 짧은 시간 안에 다시 위임하면 처음 작업 id 를 돌려준다', () => {
        expect(claimDelegatedTask('u1', '엑셀 만들어줘', 12, 't1', 1000)).toBeNull();
        expect(claimDelegatedTask('u1', '엑셀 만들어줘', 12, 't2', 1500)).toBe('t1');
        expect(claimDelegatedTask('u1', '  엑셀 만들어줘  ', 12, 't3', 1600)).toBe('t1'); // 앞뒤 공백 무시
    });

    it('목표·턴 수·사용자가 다르면 별개다', () => {
        claimDelegatedTask('u1', '엑셀 만들어줘', 12, 't1', 1000);
        expect(claimDelegatedTask('u1', 'CSV 만들어줘', 12, 't2', 1100)).toBeNull();
        expect(claimDelegatedTask('u1', '엑셀 만들어줘', 20, 't3', 1100)).toBeNull();
        expect(claimDelegatedTask('u2', '엑셀 만들어줘', 12, 't4', 1100)).toBeNull();
    });

    it('창이 지나면 새 작업으로 본다', () => {
        claimDelegatedTask('u1', '엑셀 만들어줘', 12, 't1', 1000);
        expect(claimDelegatedTask('u1', '엑셀 만들어줘', 12, 't2', 1000 + 10 * 60 * 1000)).toBeNull();
    });

    it('위임이 실패하면 풀어서 다시 위임할 수 있다', () => {
        claimDelegatedTask('u1', '엑셀 만들어줘', 12, 't1', 1000);
        releaseDelegatedTask('u1', '엑셀 만들어줘', 12);
        expect(claimDelegatedTask('u1', '엑셀 만들어줘', 12, 't2', 1100)).toBeNull();
    });
});
