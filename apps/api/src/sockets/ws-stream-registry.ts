/**
 * 진행 중 채팅 스트림 레지스트리 — 소켓이 끊겨도 생성을 이어 가고, 재연결 시 이어받게 한다.
 *
 * 배경 (2026-09-05): 탭을 백그라운드로 보내거나(모바일 Safari·iOS 앱) 잠시 다른 페이지를
 * 열면 OS 가 WebSocket 을 끊는다. 종전엔 handler.ts 의 close 핸들러가 그 즉시 생성을 abort
 * 해 답변이 통째로 사라졌다("질문했는데 응답이 없다"). 이제 소켓과 생성의 수명을 분리한다:
 *  - detach: 소켓이 닫히면 생성은 계속하고 출력은 여기 버퍼에 쌓는다. 유예(STREAM_DETACH_GRACE_MS)
 *    안에 재연결이 없으면 그때 abort (GPU 절약 의도 유지).
 *  - attach: 같은 사용자(또는 게스트 anonSessionId)가 `{type:'resume'}` 을 보내면 새 소켓에
 *    `stream_resume`(본문 스냅샷) + 밀린 이벤트를 재생하고 그대로 이어서 스트리밍한다.
 *  - 생성이 detach 상태에서 끝나면 답변은 request-handler 가 히스토리에 저장하며, 결과 스냅샷을
 *    STREAM_RESULT_RETENTION_MS 동안 보관해 늦은 재연결도 화면에 이어받게 한다.
 *
 * 사용자(키)당 1개 — 새 채팅을 시작하면 detach 된 이전 스트림은 abort 한다(사용자가 넘어감).
 * @module sockets/ws-stream-registry
 */
import { createLogger } from '../utils/logger';
import { WEBSOCKET_TIMEOUTS, WS_LIMITS } from '../config/timeouts';
import type { ExtendedWebSocket } from './ws-types';

const log = createLogger('WsStreamRegistry');

/** 본문 스냅샷으로 접히는 이벤트 — 재생하지 않고 stream_resume.content/thinking 에 합친다. */
const SNAPSHOT_EVENT_TYPES = new Set(['token', 'thinking']);
/** 스트림 종료 이벤트 — 이 뒤로는 새 이벤트가 오지 않는다. */
const TERMINAL_EVENT_TYPES = new Set(['done', 'error', 'aborted']);

export interface StreamEntry {
    key: string;
    abortController: AbortController;
    messageId?: string;
    sessionId?: string;
    /** 'token' 누적 — 재부착 시 클라이언트가 마지막 assistant 본문을 이 값으로 되돌린다. */
    content: string;
    thinking: string;
    /** detach 동안 밀린 비-토큰 이벤트(JSON 직렬화). 재부착 시 순서대로 재생. */
    buffered: string[];
    bufferedBytes: number;
    /** 버퍼 상한을 넘어 artifact_chunk 를 버렸는지 — 재생 시 chunk 순서가 깨질 수 있어 로그로 남긴다. */
    overflowed: boolean;
    ws: ExtendedWebSocket | null;
    timer: ReturnType<typeof setTimeout> | null;
    finished: boolean;
    startedAt: number;
}

/** 재부착 대상 키 — 인증 사용자는 userId, 게스트는 anonSessionId. 둘 다 없으면 이어받기 불가. */
export function resolveStreamKey(extWs: ExtendedWebSocket, anonSessionId?: string): string | null {
    if (extWs._authenticatedUserId) return `u:${extWs._authenticatedUserId}`;
    if (typeof anonSessionId === 'string' && anonSessionId.trim()) return `a:${anonSessionId.trim()}`;
    return null;
}

export class InFlightStreamRegistry {
    private readonly entries = new Map<string, StreamEntry>();
    private readonly byWs = new WeakMap<ExtendedWebSocket, StreamEntry>();

    constructor(
        private readonly graceMs: number = WEBSOCKET_TIMEOUTS.STREAM_DETACH_GRACE_MS,
        private readonly retentionMs: number = WEBSOCKET_TIMEOUTS.STREAM_RESULT_RETENTION_MS,
        private readonly bufferMaxBytes: number = WS_LIMITS.DETACHED_STREAM_BUFFER_MAX_BYTES,
    ) {}

    get size(): number { return this.entries.size; }

    /** 새 스트림 등록. 같은 키의 이전 스트림은 사용자가 넘어간 것이므로 abort 하고 버린다. */
    open(key: string, ws: ExtendedWebSocket, abortController: AbortController): StreamEntry {
        const previous = this.entries.get(key);
        if (previous) {
            log.info(`[WsStream] 같은 키의 이전 스트림 폐기: key=${key} finished=${previous.finished}`);
            this.dispose(previous, !previous.finished);
        }
        const entry: StreamEntry = {
            key, abortController, content: '', thinking: '', buffered: [], bufferedBytes: 0,
            overflowed: false, ws, timer: null, finished: false, startedAt: Date.now(),
        };
        this.entries.set(key, entry);
        this.byWs.set(ws, entry);
        return entry;
    }

    /** 소켓에 보내거나(attached) 버퍼에 쌓는다(detached). 종료 이벤트면 finished 표시. */
    send(entry: StreamEntry, payload: Record<string, unknown>): void {
        const type = String(payload.type);
        if (type === 'session_created' && typeof payload.sessionId === 'string') entry.sessionId = payload.sessionId;
        if (typeof payload.messageId === 'string' && !entry.messageId) entry.messageId = payload.messageId;
        if (type === 'token' && typeof payload.token === 'string') entry.content += payload.token;
        if (type === 'thinking' && typeof payload.token === 'string') entry.thinking += payload.token;
        if (TERMINAL_EVENT_TYPES.has(type)) entry.finished = true;

        const ws = entry.ws;
        if (ws && ws.readyState === ws.OPEN) {
            try { ws.send(JSON.stringify(payload)); } catch (e) { log.warn('[WsStream] send 실패:', e); }
            return;
        }
        if (SNAPSHOT_EVENT_TYPES.has(type)) return; // 스냅샷으로 대체
        const serialized = JSON.stringify(payload);
        if (entry.bufferedBytes + serialized.length > this.bufferMaxBytes && !TERMINAL_EVENT_TYPES.has(type)) {
            if (!entry.overflowed) {
                entry.overflowed = true;
                log.warn(`[WsStream] detach 버퍼 상한 초과 — 이후 비종료 이벤트 폐기: key=${entry.key}`);
            }
            return;
        }
        entry.buffered.push(serialized);
        entry.bufferedBytes += serialized.length;
    }

    /** 소켓 종료 — 스트림이 있으면 detach 후 유예 타이머. 없으면 false(호출자가 종전 abort 경로). */
    detach(ws: ExtendedWebSocket): boolean {
        const entry = this.byWs.get(ws);
        if (!entry || entry.ws !== ws) return false;
        this.byWs.delete(ws);
        entry.ws = null;
        ws._abortController = null;
        if (entry.finished) {
            this.scheduleRetention(entry);
            return true;
        }
        this.clearTimer(entry);
        entry.timer = setTimeout(() => {
            log.info(`[WsStream] 재연결 없이 유예 만료 → 생성 중단: key=${entry.key} elapsed=${Date.now() - entry.startedAt}ms`);
            this.dispose(entry, true);
        }, this.graceMs);
        entry.timer.unref?.();
        log.info(`[WsStream] 소켓 종료, 생성 계속(유예 ${this.graceMs}ms): key=${entry.key}`);
        return true;
    }

    /**
     * 재연결한 소켓에 스트림을 다시 붙인다. 스냅샷(stream_resume) → 밀린 이벤트 재생 순.
     * 스트림이 없으면 false — 호출자가 resume_none 을 보낸다.
     */
    attach(key: string, ws: ExtendedWebSocket): boolean {
        const entry = this.entries.get(key);
        if (!entry) return false;
        if (entry.ws && entry.ws !== ws && entry.ws.readyState === entry.ws.OPEN) {
            // 다른 탭이 이미 받고 있음 — 새 탭으로 옮긴다(마지막 접속이 이긴다).
            this.byWs.delete(entry.ws);
            entry.ws._abortController = null;
        }
        this.clearTimer(entry);
        entry.ws = ws;
        this.byWs.set(ws, entry);
        ws._abortController = entry.finished ? null : entry.abortController;
        const snapshot = {
            type: 'stream_resume',
            ...(entry.messageId ? { messageId: entry.messageId } : {}),
            ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
            content: entry.content,
            ...(entry.thinking ? { thinking: entry.thinking } : {}),
            finished: entry.finished,
        };
        try {
            ws.send(JSON.stringify(snapshot));
            for (const raw of entry.buffered) ws.send(raw);
        } catch (e) {
            log.warn('[WsStream] 재생 send 실패:', e);
        }
        log.info(`[WsStream] 스트림 재부착: key=${key} replayed=${entry.buffered.length} content=${entry.content.length}자 finished=${entry.finished}`);
        entry.buffered = [];
        entry.bufferedBytes = 0;
        if (entry.finished) this.dispose(entry, false);
        return true;
    }

    /** 명시적 중단(사용자 abort 버튼) — 즉시 abort 하고 버린다. */
    abortByWs(ws: ExtendedWebSocket): boolean {
        const entry = this.byWs.get(ws);
        if (!entry) return false;
        this.dispose(entry, true);
        return true;
    }

    /**
     * 핸들러 종료 시 호출. attached 면 즉시 정리, detached 로 끝났으면 결과 스냅샷을
     * 보존 시간 동안 남겨 늦은 재연결이 이어받게 한다.
     */
    close(entry: StreamEntry): void {
        if (this.entries.get(entry.key) !== entry) return;
        entry.finished = true;
        if (entry.ws) {
            this.dispose(entry, false);
            return;
        }
        this.scheduleRetention(entry);
    }

    private scheduleRetention(entry: StreamEntry): void {
        this.clearTimer(entry);
        entry.timer = setTimeout(() => this.dispose(entry, false), this.retentionMs);
        entry.timer.unref?.();
    }

    private dispose(entry: StreamEntry, abort: boolean): void {
        this.clearTimer(entry);
        if (abort && !entry.abortController.signal.aborted) entry.abortController.abort();
        if (entry.ws) {
            this.byWs.delete(entry.ws);
            if (entry.ws._abortController === entry.abortController) entry.ws._abortController = null;
        }
        entry.ws = null;
        entry.buffered = [];
        entry.bufferedBytes = 0;
        if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    }

    private clearTimer(entry: StreamEntry): void {
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    }
}

let singleton: InFlightStreamRegistry | null = null;
export function getInFlightStreamRegistry(): InFlightStreamRegistry {
    if (!singleton) singleton = new InFlightStreamRegistry();
    return singleton;
}
