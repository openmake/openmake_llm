/**
 * sweepHeartbeat 회귀 테스트 (2026-08-13).
 *
 * 실사례: 답변 생성이 access token(15분) 만료 시각을 걸치자 스윕이 연결을 즉시 종료하며
 * 진행 중 생성까지 abort → 답변 통째 유실. 로그도 "하트비트 미응답"으로 찍혀 네트워크
 * 문제로 오진됐다. 수정: ① 토큰 만료라도 진행 중 생성(abortController)이 있으면 이번
 * 스윕 유예 ② 종료 사유(heartbeat/token_expired) 구분 반환.
 */
import { sweepHeartbeat } from '../ws-broadcast';

const OPEN = 1; // WebSocket.OPEN

const mkWs = (over: Partial<{
    _isAlive: boolean;
    _abortController: AbortController | null;
    readyState: number;
}> = {}) => ({
    _isAlive: true,
    _abortController: null,
    readyState: OPEN,
    ping: jest.fn(),
    ...over,
});

describe('sweepHeartbeat', () => {
    it('pong 미응답 연결은 heartbeat 사유로 수집한다 (생성 중이어도)', () => {
        const zombie = mkWs({ _isAlive: false, _abortController: new AbortController() });
        const dead = sweepHeartbeat([zombie] as never, () => false);
        expect(dead).toHaveLength(1);
        expect(dead[0]!.reason).toBe('heartbeat');
    });

    it('토큰 만료 + 유휴 연결은 token_expired 사유로 수집한다', () => {
        const idle = mkWs();
        const dead = sweepHeartbeat([idle] as never, () => true);
        expect(dead).toHaveLength(1);
        expect(dead[0]!.reason).toBe('token_expired');
    });

    it('토큰 만료라도 진행 중 생성이 있으면 이번 스윕은 유예하고 ping 을 보낸다', () => {
        // 2026-08-13 실사례 — 생성 88초 진행 중 토큰 만료로 종료돼 답변 유실.
        const generating = mkWs({ _abortController: new AbortController() });
        const dead = sweepHeartbeat([generating] as never, () => true);
        expect(dead).toHaveLength(0);
        expect(generating.ping).toHaveBeenCalled();
        expect(generating._isAlive).toBe(false); // 다음 스윕의 pong 검사로 이어짐
    });

    it('정상 연결은 ping 을 보내고 alive 플래그를 내린다', () => {
        const healthy = mkWs();
        const dead = sweepHeartbeat([healthy] as never, () => false);
        expect(dead).toHaveLength(0);
        expect(healthy.ping).toHaveBeenCalled();
        expect(healthy._isAlive).toBe(false);
    });
});
