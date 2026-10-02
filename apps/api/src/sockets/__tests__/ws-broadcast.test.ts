/**
 * sendToConnections 백프레셔 — 특정 사용자 대상 송신(에이전트 작업 진행 이벤트 등)도 브로드캐스트와 같은 정책을 쓴다.
 * 느린 연결은 건너뛰고(진행 이벤트는 REST 조회로 보완된다), 연속으로 밀리면 끊는다.
 */
import { WebSocket } from 'ws';
import { sendToConnections } from '../ws-broadcast';
import { WS_LIMITS } from '../../config/timeouts';

function fakeClient(buffered = 0): WebSocket & { sent: string[]; terminated: number; bufferedAmount: number } {
    const c = {
        readyState: WebSocket.OPEN,
        bufferedAmount: buffered,
        sent: [] as string[],
        terminated: 0,
        send(raw: string) { this.sent.push(raw); },
        terminate() { this.terminated += 1; },
    };
    return c as unknown as WebSocket & { sent: string[]; terminated: number; bufferedAmount: number };
}

describe('sendToConnections', () => {
    const over = WS_LIMITS.BROADCAST_BACKPRESSURE_THRESHOLD_BYTES + 1;

    it('정상 연결에는 보낸다', () => {
        const a = fakeClient();
        sendToConnections([a], { type: 'agent_task_progress', taskId: 't1' }, new WeakMap());
        expect(a.sent.map((s) => JSON.parse(s))).toEqual([{ type: 'agent_task_progress', taskId: 't1' }]);
    });

    it('송신 버퍼가 임계를 넘은 연결은 건너뛰고 다른 연결에는 보낸다', () => {
        const slow = fakeClient(over);
        const fast = fakeClient();
        sendToConnections([slow, fast], { type: 'x' }, new WeakMap());
        expect(slow.sent).toHaveLength(0);
        expect(fast.sent).toHaveLength(1);
        expect(slow.terminated).toBe(0);
    });

    it('연속으로 임계를 넘으면 끊고, 회복하면 카운터를 되돌린다', () => {
        const counters = new WeakMap<WebSocket, number>();
        const slow = fakeClient(over);
        const n = WS_LIMITS.BROADCAST_BACKPRESSURE_TERMINATE_AFTER;
        for (let i = 0; i < n - 1; i++) sendToConnections([slow], { type: 'x' }, counters);
        expect(slow.terminated).toBe(0);
        slow.bufferedAmount = 0;
        sendToConnections([slow], { type: 'x' }, counters); // 회복 → 리셋
        expect(slow.sent).toHaveLength(1);
        slow.bufferedAmount = over;
        for (let i = 0; i < n; i++) sendToConnections([slow], { type: 'x' }, counters);
        expect(slow.terminated).toBe(1);
    });

    it('카운터를 주지 않으면 종전대로 검사 없이 보낸다(호환)', () => {
        const slow = fakeClient(over);
        sendToConnections([slow], { type: 'x' });
        expect(slow.sent).toHaveLength(1);
    });
});
