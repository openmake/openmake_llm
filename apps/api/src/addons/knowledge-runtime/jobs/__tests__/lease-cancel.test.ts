// apps/api/src/addons/knowledge-runtime/jobs/__tests__/lease-cancel.test.ts
/**
 * lease 취소 — 취소는 상실과 같은 신호(abort)로 핸들러를 멈추되 오류 형으로 구분된다(JobCancelledError ⊂ LeaseLostError).
 * 첫 사유만 남는다: 먼저 잃은 lease 는 취소로 바뀌지 않고, 먼저 취소된 lease 는 상실로 바뀌지 않는다.
 */
import { createJobLease, JobCancelledError, LeaseLostError } from '../lease';

const lease = () => createJobLease({ jobId: 'j1', token: '3', owner: 'w', now: 0 });

function caught(fn: () => void): unknown {
    try {
        fn();
    } catch (err) {
        return err;
    }
    return undefined;
}

describe('lease 취소', () => {
    it('markCancelled 뒤 신호가 끊기고 throwIfLost 는 JobCancelledError(LeaseLostError 하위형)', () => {
        const l = lease();
        l.markCancelled('사용자 취소');
        expect(l.signal.aborted).toBe(true);
        expect(l.isCancelled()).toBe(true);
        const err = caught(() => l.throwIfLost());
        expect(err).toBeInstanceOf(JobCancelledError);
        expect(err).toBeInstanceOf(LeaseLostError);
        expect((err as Error).name).toBe('JobCancelledError');
        expect((err as Error).message).toBe('작업 j1 이 취소됐다 — 사용자 취소');
    });

    it('먼저 잃은 lease 는 취소로 바뀌지 않는다', () => {
        const l = lease();
        l.markLost('heartbeat 0행');
        l.markCancelled('늦은 취소');
        expect(l.isCancelled()).toBe(false);
        const err = caught(() => l.throwIfLost());
        expect(err).toBeInstanceOf(LeaseLostError);
        expect(err).not.toBeInstanceOf(JobCancelledError);
    });

    it('먼저 취소된 lease 는 상실로 바뀌지 않는다', () => {
        const l = lease();
        l.markCancelled('사용자 취소');
        l.markLost('drain 시간 초과');
        expect(l.isCancelled()).toBe(true);
        expect(caught(() => l.throwIfLost())).toBeInstanceOf(JobCancelledError);
    });

    it('아무 일도 없으면 던지지 않는다', () => {
        const l = lease();
        expect(l.isCancelled()).toBe(false);
        expect(() => l.throwIfLost()).not.toThrow();
    });
});
