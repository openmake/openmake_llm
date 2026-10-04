/**
 * CDP(Chrome DevTools Protocol) 최소 클라이언트 — 브라우저 수준 WebSocket 하나로 명령·이벤트를 주고받는다.
 * 탭은 `Target.attachToTarget({flatten:true})` 로 붙고 이후 명령에 sessionId 를 실어 구분한다.
 * 외부 자동화 라이브러리를 쓰지 않는다 — 헬퍼 번들(esbuild 단일 파일)에 그대로 들어가야 한다.
 */
import WebSocket from 'ws';
import { BROWSER_CDP_TIMEOUT_MS } from '../constants';

type Handler = (params: Record<string, unknown>, sessionId?: string) => void;

interface Pending {
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
}

export class CdpClient {
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private readonly handlers = new Map<string, Set<Handler>>();
    private closed = false;

    private constructor(private readonly ws: WebSocket) {
        ws.on('message', (d: WebSocket.RawData) => this.onMessage(d.toString()));
        ws.on('close', () => this.failAll('브라우저 연결이 끊어졌습니다'));
        ws.on('error', () => { /* close 가 후속 처리 */ });
    }

    static connect(wsUrl: string, timeoutMs = BROWSER_CDP_TIMEOUT_MS): Promise<CdpClient> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
            const timer = setTimeout(() => { ws.terminate(); reject(new Error('브라우저 연결 시간 초과')); }, timeoutMs);
            ws.once('open', () => { clearTimeout(timer); resolve(new CdpClient(ws)); });
            ws.once('error', (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); });
        });
    }

    get isOpen(): boolean { return !this.closed && this.ws.readyState === WebSocket.OPEN; }

    send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = BROWSER_CDP_TIMEOUT_MS): Promise<Record<string, unknown>> {
        if (!this.isOpen) return Promise.reject(new Error('브라우저 연결이 닫혀 있습니다'));
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`브라우저 응답 시간 초과 (${method})`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
            } catch (e) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
    }

    /** 이벤트 구독 — 해제 함수를 돌려준다. */
    on(event: string, handler: Handler): () => void {
        let set = this.handlers.get(event);
        if (!set) { set = new Set(); this.handlers.set(event, set); }
        set.add(handler);
        return () => { set!.delete(handler); };
    }

    /** 이벤트 한 번을 기다린다 — 조건(pred)에 맞는 것만. 시간 초과면 null. */
    waitFor(event: string, pred: (params: Record<string, unknown>, sessionId?: string) => boolean, timeoutMs: number): Promise<Record<string, unknown> | null> {
        return new Promise((resolve) => {
            const off = this.on(event, (params, sessionId) => {
                if (!pred(params, sessionId)) return;
                clearTimeout(timer); off(); resolve(params);
            });
            const timer = setTimeout(() => { off(); resolve(null); }, timeoutMs);
        });
    }

    close(): void {
        if (this.closed) return;
        this.failAll('브라우저 연결을 닫았습니다');
        try { this.ws.close(); } catch { /* noop */ }
    }

    private onMessage(raw: string): void {
        let m: { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string }; sessionId?: string };
        try { m = JSON.parse(raw); } catch { return; }
        if (typeof m.id === 'number') {
            const p = this.pending.get(m.id);
            if (!p) return;
            clearTimeout(p.timer);
            this.pending.delete(m.id);
            if (m.error) p.reject(new Error(m.error.message ?? 'CDP 오류')); else p.resolve(m.result ?? {});
            return;
        }
        if (typeof m.method !== 'string') return;
        const set = this.handlers.get(m.method);
        if (!set) return;
        for (const h of [...set]) {
            try { h(m.params ?? {}, m.sessionId); } catch { /* 구독자 오류가 수신 루프를 죽이지 않게 */ }
        }
    }

    private failAll(reason: string): void {
        this.closed = true;
        for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            p.reject(new Error(reason));
        }
    }
}
