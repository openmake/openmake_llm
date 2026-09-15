/**
 * 상태 머신 전이표(124) — 실경로에서 도출한 전이는 허용, 표 밖은 거부.
 */
import { isTransitionAllowed, allowedSources, AgentTaskTransitionError } from '../task-state';

describe('agent task 상태 전이표', () => {
    it('실경로 전이는 허용된다', () => {
        expect(isTransitionAllowed('pending', 'running')).toBe(true);   // 실행 시작
        expect(isTransitionAllowed('pending', 'queued')).toBe(true);    // 큐 대기
        expect(isTransitionAllowed('running', 'paused')).toBe(true);    // 승인 대기
        expect(isTransitionAllowed('paused', 'running')).toBe(true);    // 승인 해소
        expect(isTransitionAllowed('paused', 'failed')).toBe(true);     // 부팅 마킹(server restarted)
        expect(isTransitionAllowed('failed', 'pending')).toBe(true);    // 재실행 리셋·복구 claim
        expect(isTransitionAllowed('failed', 'running')).toBe(true);    // resume
        expect(isTransitionAllowed('cancelled', 'running')).toBe(true); // 취소 작업 resume
        expect(isTransitionAllowed('queued', 'cancelled')).toBe(true);  // 대기열 취소
    });

    it('같은 상태로의 갱신은 no-op 으로 허용된다', () => {
        expect(isTransitionAllowed('paused', 'paused')).toBe(true);
        expect(isTransitionAllowed('completed', 'completed')).toBe(true);
    });

    it('completed 는 어디로도 가지 않고, 표 밖 전이는 거부된다', () => {
        expect(isTransitionAllowed('completed', 'running')).toBe(false);
        expect(isTransitionAllowed('completed', 'failed')).toBe(false);
        expect(isTransitionAllowed('pending', 'paused')).toBe(false);   // 실행 전에 승인 대기는 없다
        expect(isTransitionAllowed('cancelled', 'failed')).toBe(false);
    });

    it('allowedSources 는 자기 자신을 포함한 출발 상태 목록이다(조건부 UPDATE 재료)', () => {
        expect(allowedSources('running').sort()).toEqual(['cancelled', 'failed', 'paused', 'pending', 'queued', 'running'].sort());
        expect(allowedSources('completed').sort()).toEqual(['completed', 'paused', 'running'].sort());
    });

    it('AgentTaskTransitionError 는 작업·전이를 메시지에 담는다', () => {
        const e = new AgentTaskTransitionError('t1', 'completed', 'running');
        expect(e.message).toContain('t1');
        expect(e.message).toContain('completed → running');
    });
});
