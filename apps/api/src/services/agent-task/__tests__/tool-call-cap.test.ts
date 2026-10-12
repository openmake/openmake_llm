/**
 * 도구 호출 공통 시간 상한 — 내장·외부 도구 하나가 끝나지 않으면 작업이 running 으로 무기한 남았다
 * (시간 예산은 턴 사이와 모델 호출에서만 검사하고, 소유권 연장은 루프 진행과 무관한 타이머다).
 */
import { runWithToolCallCap } from '../tool-call-cap';
import { AgentTaskAbort } from '../types';

const never = (): Promise<string> => new Promise<string>(() => { /* 끝나지 않는 도구 */ });
const base = { capMs: 1000, isWaitingForUser: () => false, onTimeout: () => 'TIMEOUT' };

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('runWithToolCallCap', () => {
    it('상한 안에 끝난 호출은 결과를 그대로 돌려준다', async () => {
        const p = runWithToolCallCap(async () => 'ok', { ...base, signal: new AbortController().signal });
        await expect(p).resolves.toBe('ok');
        expect(jest.getTimerCount()).toBe(0); // 타이머를 남기지 않는다
    });

    it('상한을 넘긴 호출은 기다리기를 멈추고 시간 초과 결과를 돌려준다', async () => {
        const p = runWithToolCallCap(never, { ...base, signal: new AbortController().signal });
        await jest.advanceTimersByTimeAsync(1000);
        await expect(p).resolves.toBe('TIMEOUT');
    });

    it('사용자 입력을 기다리는 동안은 세지 않고, 대기가 끝나면 새 창으로 다시 센다', async () => {
        let waiting = true;
        const p = runWithToolCallCap(never, { ...base, isWaitingForUser: () => waiting, signal: new AbortController().signal });
        let settled = false;
        void p.then(() => { settled = true; });
        await jest.advanceTimersByTimeAsync(3000);
        expect(settled).toBe(false);
        waiting = false;
        await jest.advanceTimersByTimeAsync(1000);
        await expect(p).resolves.toBe('TIMEOUT');
    });

    it('중단 신호가 오면 도구가 끝나기를 기다리지 않고 바로 중단한다', async () => {
        const ac = new AbortController();
        const p = runWithToolCallCap(never, { ...base, signal: ac.signal });
        const caught = p.catch((e: unknown) => e);
        ac.abort();
        await expect(caught).resolves.toBeInstanceOf(AgentTaskAbort);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('도구의 예외는 그대로 전달한다', async () => {
        const p = runWithToolCallCap(async () => { throw new Error('boom'); }, { ...base, signal: new AbortController().signal });
        await expect(p).rejects.toThrow('boom');
    });

    it('상한이 0 이면 시간으로는 끊지 않는다(중단 신호만 본다)', async () => {
        const ac = new AbortController();
        const p = runWithToolCallCap(never, { ...base, capMs: 0, signal: ac.signal });
        const caught = p.catch((e: unknown) => e);
        await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
        ac.abort();
        await expect(caught).resolves.toBeInstanceOf(AgentTaskAbort);
    });
});
