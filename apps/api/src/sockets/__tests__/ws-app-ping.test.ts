/**
 * 앱 수준 ping → pong (2026-10-29) — 브라우저는 프로토콜 ping 을 볼 수 없어 half-open 소켓을 늦게 안다.
 * 클라이언트가 보내는 `{type:'ping', t?}` 에 즉시 `{type:'pong', t}` 로 답한다.
 */
import { WebSocket } from 'ws';
import { replyToAppPing } from '../ws-app-ping';

function fakeWs(readyState: number = WebSocket.OPEN): { ws: WebSocket; sent: string[] } {
    const sent: string[] = [];
    return { ws: { readyState, send: (d: string) => { sent.push(d); } } as unknown as WebSocket, sent };
}

describe('replyToAppPing', () => {
    it('ping 이면 t 를 그대로 담아 pong 으로 답하고 true 를 돌려준다', () => {
        const { ws, sent } = fakeWs();
        expect(replyToAppPing(ws, { type: 'ping', t: 1234 })).toBe(true);
        expect(sent.map((s) => JSON.parse(s))).toEqual([{ type: 'pong', t: 1234 }]);
    });

    it('t 가 없거나 숫자가 아니면 t 없이 답한다', () => {
        const { ws, sent } = fakeWs();
        expect(replyToAppPing(ws, { type: 'ping' })).toBe(true);
        expect(replyToAppPing(ws, { type: 'ping', t: 'x'.repeat(10) })).toBe(true);
        expect(replyToAppPing(ws, { type: 'ping', t: Number.NaN })).toBe(true);
        expect(sent.map((s) => JSON.parse(s))).toEqual([{ type: 'pong' }, { type: 'pong' }, { type: 'pong' }]);
    });

    it('ping 이 아니면 아무것도 보내지 않고 false', () => {
        const { ws, sent } = fakeWs();
        expect(replyToAppPing(ws, { type: 'chat', message: 'hi' })).toBe(false);
        expect(replyToAppPing(ws, null)).toBe(false);
        expect(replyToAppPing(ws, 'ping')).toBe(false);
        expect(sent).toEqual([]);
    });

    it('소켓이 OPEN 이 아니면 보내지 않지만 ping 은 소비한다(true)', () => {
        const { ws, sent } = fakeWs(WebSocket.CLOSING);
        expect(replyToAppPing(ws, { type: 'ping', t: 1 })).toBe(true);
        expect(sent).toEqual([]);
    });
});
