/**
 * 인증 전 도착 프레임 버퍼 — 연결 콜백의 await 구간에 온 메시지가 사라지지 않아야 한다 (2026-09-11).
 */
import { EventEmitter } from 'events';
import type { RawData, WebSocket } from 'ws';
import { bufferEarlyMessages } from '../ws-early-messages';
import { WS_LIMITS } from '../../config/timeouts';

/** ws 대신 쓰는 최소 소켓 — on/off/emit 만 필요하다. */
function fakeWs(): { ws: WebSocket; emitter: EventEmitter } {
    const emitter = new EventEmitter();
    return { ws: emitter as unknown as WebSocket, emitter };
}
const frame = (s: string): RawData => Buffer.from(s) as unknown as RawData;
const text = (d: RawData): string => d.toString();

describe('bufferEarlyMessages', () => {
    it('attach 전에 도착한 프레임을 도착 순서대로 재생한다', () => {
        const { ws, emitter } = fakeWs();
        const early = bufferEarlyMessages(ws);
        emitter.emit('message', frame('hello'));
        emitter.emit('message', frame('second'));

        const seen: string[] = [];
        early.attach((d) => { seen.push(text(d)); });
        expect(seen).toEqual(['hello', 'second']);
    });

    it('attach 이후 도착분은 핸들러가 직접 받고, 재생과 중복되지 않는다', () => {
        const { ws, emitter } = fakeWs();
        const early = bufferEarlyMessages(ws);
        emitter.emit('message', frame('before'));

        const seen: string[] = [];
        early.attach((d) => { seen.push(text(d)); });
        emitter.emit('message', frame('after'));
        expect(seen).toEqual(['before', 'after']);
        expect(emitter.listenerCount('message')).toBe(1); // 임시 수집기는 떨어졌다
    });

    it('discard 는 재생하지 않고 수집기도 뗀다 (연결 거부 경로)', () => {
        const { ws, emitter } = fakeWs();
        const early = bufferEarlyMessages(ws);
        emitter.emit('message', frame('dropped'));
        early.discard();
        expect(emitter.listenerCount('message')).toBe(0);
    });

    it('프레임 수 상한을 넘으면 통째로 거부한다 — 오류 전송 후 1009 로 닫고 재생하지 않는다', () => {
        const { ws, emitter } = fakeWs();
        const sent: string[] = [];
        const closed: Array<[number, string]> = [];
        (emitter as unknown as { send: (s: string) => void }).send = (s) => { sent.push(s); };
        (emitter as unknown as { close: (c: number, r: string) => void }).close = (c, r) => { closed.push([c, r]); };
        const early = bufferEarlyMessages(ws);
        for (let i = 0; i <= WS_LIMITS.EARLY_BUFFER_MAX_FRAMES; i += 1) emitter.emit('message', frame(`f${i}`));

        expect(closed).toEqual([[1009, 'early_buffer_overflow']]);
        expect(JSON.parse(sent[0])).toMatchObject({ type: 'error' });
        expect(emitter.listenerCount('message')).toBe(0); // 더 모으지 않는다
        const seen: string[] = [];
        early.attach((d) => { seen.push(text(d)); });
        expect(seen).toEqual([]); // 일부만 재생해 순서가 깨지는 일이 없다
    });

    it('총 바이트 상한을 넘는 프레임도 같은 방식으로 거부한다', () => {
        const { ws, emitter } = fakeWs();
        const closed: number[] = [];
        (emitter as unknown as { send: (s: string) => void }).send = () => { /* noop */ };
        (emitter as unknown as { close: (c: number) => void }).close = (c) => { closed.push(c); };
        bufferEarlyMessages(ws);
        emitter.emit('message', frame('small'));
        emitter.emit('message', frame('x'.repeat(WS_LIMITS.EARLY_BUFFER_MAX_BYTES + 1)));
        expect(closed).toEqual([1009]);
    });

    it('attach·discard 전에 소켓이 닫히면 버퍼가 스스로 정리된다', () => {
        const { ws, emitter } = fakeWs();
        bufferEarlyMessages(ws);
        emitter.emit('message', frame('orphan'));
        emitter.emit('close');
        expect(emitter.listenerCount('message')).toBe(0);
        expect(emitter.listenerCount('close')).toBe(0);
    });
});
