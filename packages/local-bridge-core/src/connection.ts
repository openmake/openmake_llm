/**
 * BridgeConnection — 브리지 WS 프로토콜 상태기계 (hello/디스패치/reqId 상관/재연결).
 *
 * 인증 방식은 호스트가 다르다(데스크톱=세션 쿠키+Origin+주기 refresh, CLI=API key 헤더) —
 * headers()/onOpen 훅으로 주입하고 프로토콜 골격만 공유한다.
 *
 * 서버→디바이스 프레임은 bridge_exec(요청)·bridge_notice(단방향 알림) 두 가지만 처리하고 나머지는
 * 무시한다. 알림은 검증을 통과한 것만 호스트(onNotice)에 넘길 뿐 아무 동작도 일으키지 않는다.
 */
import WebSocket from 'ws';
import { NOTICE_KINDS, NOTICE_TOOL_NAME_MAX, RECONNECT_MS, TASK_ID_RE } from './constants';
import type { BridgeCore } from './core';
import type { BridgeMsg, BridgeNotice, BridgeResult, BridgeStatusCode } from './types';

export interface BridgeConnectionOptions {
    /** 서버 http(s) URL — ws(s) 로 변환해 접속한다 (서버 WSS 는 { server } 라 경로 무관). */
    serverUrl: string;
    core: BridgeCore;
    deviceId: string;
    label: string;
    /** 접속 헤더 — 호출 시점마다 재평가(데스크톱은 최신 세션 쿠키를 읽는다). */
    headers: () => Promise<Record<string, string>> | Record<string, string>;
    /** 상태 알림 — s 는 한국어 고정 문구, code·arg 는 호스트 다국어 표시용(CLI 는 s 만 쓴다). */
    onStatus?: (s: string, code?: BridgeStatusCode, arg?: string) => void;
    /** 서버 단방향 알림(검증 통과분만) — 컴패니언은 네이티브 알림으로 띄운다. 미지정이면 무시. */
    onNotice?: (n: BridgeNotice) => void;
    /** open 직후 훅 — 데스크톱의 주기 refresh 타이머 등. 반환한 cleanup 은 close 시 호출. */
    onOpen?: (ws: WebSocket) => (() => void) | void;
    /** 재연결 여부 — 데스크톱은 폴더 연결 상태, CLI 는 disconnect() 호출 여부로 판단. */
    shouldReconnect?: () => boolean;
    reconnectMs?: number;
}

/** 제어문자(0x00~0x1f, 0x7f) 제거 — 서버 발 텍스트를 알림에 그대로 싣지 않는다. */
function stripControl(s: string): string {
    let out = '';
    for (const ch of s) {
        const c = ch.charCodeAt(0);
        if (c >= 0x20 && c !== 0x7f) out += ch;
    }
    return out;
}

/** bridge_notice 검증 — 화이트리스트 종류·taskId 형식·표시 텍스트 정리. 부적합하면 null. */
export function parseNotice(m: BridgeMsg): BridgeNotice | null {
    if (!NOTICE_KINDS.includes(m.notice ?? '')) return null;
    if (typeof m.taskId !== 'string' || !TASK_ID_RE.test(m.taskId)) return null;
    if (typeof m.toolName !== 'string') return null;
    const toolName = stripControl(m.toolName).trim().slice(0, NOTICE_TOOL_NAME_MAX);
    if (!toolName) return null;
    return { notice: 'approval_pending', taskId: m.taskId, toolName };
}

export class BridgeConnection {
    private ws: WebSocket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private openCleanup: (() => void) | null = null;
    private closed = false;

    constructor(private readonly opts: BridgeConnectionOptions) {}

    private status(s: string, code?: BridgeStatusCode, arg?: string): void { this.opts.onStatus?.(s, code, arg); }

    async connect(): Promise<void> {
        this.closed = false;
        this.opts.core.prepare();
        const wsUrl = this.opts.serverUrl.replace(/^http/, 'ws');
        try { if (this.ws) { this.ws.removeAllListeners(); this.ws.close(); } } catch { /* noop */ }
        // headers() 실패(예: 데스크톱 세션 토큰 부재)는 소켓 생성 전이므로 재연결 루프를
        // 걸지 않고 멈춘다 — 종전 데스크톱 의미(로그인 후 사용자가 다시 연결) 보존.
        let headers: Record<string, string>;
        try {
            headers = await this.opts.headers();
        } catch (e) {
            const msg = String((e as Error).message || e);
            this.status(msg, 'auth_error', msg);
            return;
        }
        this.ws = new WebSocket(wsUrl, { headers });
        this.status('연결 중…', 'connecting');
        const folderName = this.opts.core.folderRoot.split('/').filter(Boolean).pop() || '/';

        this.ws.on('open', () => setTimeout(() => {
            // 서버가 연결을 등록하고 메시지 리스너를 부착할 때까지 대기(라이브 확인 300ms).
            // 즉시 전송하면 리스너 부착 전 프레임이 유실돼 등록이 안 된다.
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.ws.send(JSON.stringify({
                type: 'bridge_hello',
                deviceId: this.opts.deviceId,
                label: this.opts.label,
                folderName,
            }));
            this.openCleanup = this.opts.onOpen?.(this.ws) ?? null;
        }, 300));

        this.ws.on('message', (d: WebSocket.RawData) => {
            let m: BridgeMsg;
            try { m = JSON.parse(d.toString()) as BridgeMsg; } catch { return; }
            if (m.type === 'bridge_ready') { this.status(`연결됨: ${folderName}`, 'connected', folderName); return; }
            if (m.type === 'error') { this.status(`서버 오류: ${m.message ?? ''}`, 'server_error', m.message ?? ''); return; }
            if (m.type === 'bridge_notice') {
                const n = parseNotice(m);
                if (n) this.opts.onNotice?.(n);
                return; // 단방향 — 응답 프레임을 보내지 않는다
            }
            if (m.type !== 'bridge_exec') return;
            const t0 = Date.now();
            const done = (result: BridgeResult): void => {
                try {
                    this.ws!.send(JSON.stringify({
                        type: 'bridge_result', reqId: m.reqId,
                        result: { durationMs: Date.now() - t0, ...result },
                    }));
                } catch { /* noop */ }
            };
            // handleExec 는 async(exec 승인 대기) — sync/async 예외를 모두 done 으로 흡수.
            Promise.resolve().then(() => this.opts.core.handleExec(m, done))
                .catch((e) => done({ ok: false, error: String((e as Error).message || e) }));
        });

        this.ws.on('close', () => {
            this.openCleanup?.(); this.openCleanup = null;
            const reconnect = !this.closed && (this.opts.shouldReconnect?.() ?? true);
            if (!reconnect) {
                if (this.closed) this.status('종료', 'closed'); else this.status('미연결', 'idle');
                return;
            }
            this.status('끊김 — 재연결 대기', 'reconnecting');
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => { void this.connect(); }, this.opts.reconnectMs ?? RECONNECT_MS);
        });
        this.ws.on('error', () => { /* close 가 후속 처리 */ });
    }

    disconnect(): void {
        this.closed = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.opts.core.clearAutoApprove(); // 연결이 끊기면 일괄 승인도 회수한다(다음 연결로 새지 않게).
        try { if (this.ws) this.ws.close(); } catch { /* noop */ }
        this.ws = null;
    }

    /** 현재 소켓 — 호스트 전용 프레임(refresh 등) 전송용. */
    socket(): WebSocket | null { return this.ws; }
}
