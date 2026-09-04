/** REST 리서치 취소 레지스트리 — 2026-09-05 (REST execute abort 미배선 결함 수정) */
import { registerActiveRun, unregisterActiveRun, abortActiveRun, isActiveRun } from '../active-runs';

describe('active-runs', () => {
    it('등록 → abort 시 signal 이 aborted 되고 레지스트리에서 제거된다', () => {
        const c = registerActiveRun('s1');
        expect(isActiveRun('s1')).toBe(true);
        expect(abortActiveRun('s1')).toBe(true);
        expect(c.signal.aborted).toBe(true);
        expect(isActiveRun('s1')).toBe(false);
    });

    it('미등록 세션 abort 는 false (다른 프로세스에서 실행 중일 수 있어 404 아님)', () => {
        expect(abortActiveRun('nope')).toBe(false);
    });

    it('같은 세션 재등록은 이전 컨트롤러를 abort 한다', () => {
        const a = registerActiveRun('s2');
        const b = registerActiveRun('s2');
        expect(a.signal.aborted).toBe(true);
        expect(b.signal.aborted).toBe(false);
        unregisterActiveRun('s2', b);
        expect(isActiveRun('s2')).toBe(false);
    });

    it('unregister 는 등록된 컨트롤러와 다르면 무시한다 (늦게 끝난 구 실행이 새 실행을 지우지 않음)', () => {
        const old = registerActiveRun('s3');
        const fresh = registerActiveRun('s3');
        unregisterActiveRun('s3', old);
        expect(isActiveRun('s3')).toBe(true);
        unregisterActiveRun('s3', fresh);
        expect(isActiveRun('s3')).toBe(false);
    });
});
