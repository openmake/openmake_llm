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
 *
 * 순번 이어받기 (2026-09-17, F19.11): 모든 이벤트에 `streamId`·`seq`(스트림 안 단조 증가)를 붙이고, 비-토큰 이벤트는
 * attached 여부와 무관하게 링버퍼(바이트·개수 상한)에 남긴다. 클라이언트가 `resume{streamId, afterSeq}` 를 보내면
 * 스냅샷 + `seq > afterSeq` 이벤트만 재생해 중복·유실 없이 잇는다(본문 진실은 여전히 스냅샷 — 토큰은 재생하지 않는다).
 * 커서가 없거나 다른 스트림이면 종전대로 스냅샷 + 어느 소켓에도 전달되지 않은 이벤트만 재생한다(구 클라이언트 호환).
 * 링에서 밀려난 이벤트가 재생 범위에 있었으면 `stream_resume.gap:true` — 클라이언트는 done.cleanedContent 로 재구성한다.
 * @module sockets/ws-stream-registry
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import { WEBSOCKET_TIMEOUTS, WS_LIMITS } from '../config/timeouts';
import type { ExtendedWebSocket } from './ws-types';

const log = createLogger('WsStreamRegistry');

/** 본문 스냅샷으로 접히는 이벤트 — 재생하지 않고 stream_resume.content/thinking 에 합친다. */
const SNAPSHOT_EVENT_TYPES = new Set(['token', 'thinking']);
/** 스트림 종료 이벤트 — 이 뒤로는 새 이벤트가 오지 않는다. */
const TERMINAL_EVENT_TYPES = new Set(['done', 'error', 'aborted']);

interface RingEvent {
    seq: number;
    /** 직렬화된 이벤트(streamId·seq 포함) */
    raw: string;
}

interface StreamEntry {
    key: string;
    abortController: AbortController;
    /** 이어받기 커서의 스트림 식별자 — open() 때 발급 */
    streamId: string;
    /** 마지막으로 발급한 순번(0 = 아직 없음) */
    seq: number;
    /** 소켓으로 전송에 성공한 마지막 순번 — 커서 없는 재부착은 이 뒤만 재생한다 */
    deliveredSeq: number;
    messageId?: string;
    sessionId?: string;
    /** 마지막 served_model 값 — stream_resume 스냅샷에 실어 링이 밀려도 답하는 모델을 잃지 않게 한다 */
    servedModel?: string;
    /** 'token' 누적 — 재부착 시 클라이언트가 마지막 assistant 본문을 이 값으로 되돌린다. */
    content: string;
    thinking: string;
    /** 비-토큰 이벤트 링버퍼 — ringMax>0 이면 상시, 0 이면 detach 동안만(종전 동작). 오래된 것부터 밀려난다. */
    ring: RingEvent[];
    ringBytes: number;
    /** 링에서 밀려난 이벤트의 최대 순번(없으면 0) — 재생 범위와 겹치면 gap */
    droppedMaxSeq: number;
    /** 링 상한을 넘어 이벤트를 버린 적이 있는지 */
    overflowed: boolean;
    ws: ExtendedWebSocket | null;
    timer: ReturnType<typeof setTimeout> | null;
    finished: boolean;
    startedAt: number;
}

/** 레인 식별자 정규화 — 유효한 형식(`^[a-z0-9_-]{1,16}$`)이면 그대로, 그 외는 null(레인 없음). (2026-09-09) */
export function normalizeStreamLane(lane: unknown): string | null {
    if (typeof lane !== 'string') return null;
    return /^[a-z0-9_-]{1,16}$/.test(lane) ? lane : null;
}

/**
 * 재부착 대상 키 — 인증 사용자는 userId, 게스트는 anonSessionId. 둘 다 없으면 이어받기 불가.
 * lane 이 유효하면 `#<lane>` 접미사를 붙여 같은 사용자의 레인별 독립 스트림을 허용한다. (2026-09-09)
 */
/**
 * 게스트 스트림 키로 받아들이는 anonSessionId 형식 — 프론트는 crypto.randomUUID()(36자)를 쓴다.
 * 짧거나 임의 문자가 섞인 값은 키가 되지 못해(resume_none) 추측 가능한 id 로 타인 게스트 스트림을
 * 읽거나 가로채는 여지를 줄인다. (2026-09-13 보안 점검)
 */
const GUEST_STREAM_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function resolveStreamKey(extWs: ExtendedWebSocket, anonSessionId?: string, lane?: unknown): string | null {
    let base: string | null = null;
    if (extWs._authenticatedUserId) base = `u:${extWs._authenticatedUserId}`;
    else if (typeof anonSessionId === 'string' && GUEST_STREAM_ID_RE.test(anonSessionId.trim())) base = `a:${anonSessionId.trim()}`;
    if (!base) return null;
    const normalized = normalizeStreamLane(lane);
    return normalized ? `${base}#${normalized}` : base;
}

export class InFlightStreamRegistry {
    private readonly entries = new Map<string, StreamEntry>();
    private readonly byWs = new WeakMap<ExtendedWebSocket, StreamEntry>();

    constructor(
        private readonly graceMs: number = WEBSOCKET_TIMEOUTS.STREAM_DETACH_GRACE_MS,
        private readonly retentionMs: number = WEBSOCKET_TIMEOUTS.STREAM_RESULT_RETENTION_MS,
        private readonly bufferMaxBytes: number = WS_LIMITS.DETACHED_STREAM_BUFFER_MAX_BYTES,
        private readonly ringMax: number = WS_LIMITS.STREAM_EVENT_RING_MAX,
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
            key, abortController, streamId: randomUUID(), seq: 0, deliveredSeq: 0, content: '', thinking: '',
            ring: [], ringBytes: 0, droppedMaxSeq: 0, overflowed: false, ws, timer: null, finished: false, startedAt: Date.now(),
        };
        this.entries.set(key, entry);
        this.byWs.set(ws, entry);
        return entry;
    }

    /**
     * 순번을 붙여 소켓에 보내고(attached), 비-토큰 이벤트는 링버퍼에 남긴다(ringMax>0 상시, 0 이면 전달 못 했을 때만).
     * 종료 이벤트면 finished 표시.
     */
    send(entry: StreamEntry, payload: Record<string, unknown>): void {
        const type = String(payload.type);
        if (type === 'session_created' && typeof payload.sessionId === 'string') entry.sessionId = payload.sessionId;
        if (typeof payload.messageId === 'string' && !entry.messageId) entry.messageId = payload.messageId;
        if (type === 'served_model' && typeof payload.model === 'string') entry.servedModel = payload.model;
        if (type === 'token' && typeof payload.token === 'string') entry.content += payload.token;
        if (type === 'thinking' && typeof payload.token === 'string') entry.thinking += payload.token;
        if (TERMINAL_EVENT_TYPES.has(type)) entry.finished = true;

        entry.seq += 1;
        const seq = entry.seq;
        const serialized = JSON.stringify({ ...payload, streamId: entry.streamId, seq });
        let delivered = false;
        const ws = entry.ws;
        if (ws && ws.readyState === ws.OPEN) {
            try {
                ws.send(serialized);
                delivered = true;
                entry.deliveredSeq = seq;
            } catch (e) { log.warn('[WsStream] send 실패:', e); }
        }
        if (SNAPSHOT_EVENT_TYPES.has(type)) return; // 스냅샷으로 대체
        if (this.ringMax > 0 || !delivered) this.pushRing(entry, seq, serialized);
    }

    /** 링에 넣고 상한(개수·바이트)을 넘으면 오래된 것부터 밀어낸다 — 방금 넣은 이벤트는 남긴다. */
    private pushRing(entry: StreamEntry, seq: number, raw: string): void {
        entry.ring.push({ seq, raw });
        entry.ringBytes += raw.length;
        const maxCount = this.ringMax > 0 ? this.ringMax : Number.POSITIVE_INFINITY;
        while (entry.ring.length > 1 && (entry.ring.length > maxCount || entry.ringBytes > this.bufferMaxBytes)) {
            const dropped = entry.ring.shift()!;
            entry.ringBytes -= dropped.raw.length;
            entry.droppedMaxSeq = Math.max(entry.droppedMaxSeq, dropped.seq);
            if (!entry.overflowed) {
                entry.overflowed = true;
                log.warn(`[WsStream] 이벤트 링 상한 초과 — 오래된 이벤트부터 폐기: key=${entry.key}`);
            }
        }
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
     * 재연결한 소켓에 스트림을 다시 붙인다. 스냅샷(stream_resume) → 이벤트 재생 순.
     * - cursor 의 streamId 가 이 스트림이고 afterSeq 가 유효하면 `seq > afterSeq` 만 재생(중복 없음)
     * - 아니면 어느 소켓에도 전달되지 않은 이벤트(`seq > deliveredSeq`)만 재생(종전 동작)
     * 스트림이 없으면 false — 호출자가 resume_none 을 보낸다.
     */
    attach(key: string, ws: ExtendedWebSocket, cursor: { streamId?: string; afterSeq?: number } = {}): boolean {
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
        const useCursor = cursor.streamId === entry.streamId
            && Number.isInteger(cursor.afterSeq) && (cursor.afterSeq as number) >= 0 && (cursor.afterSeq as number) <= entry.seq;
        const threshold = useCursor ? (cursor.afterSeq as number) : entry.deliveredSeq;
        const replay = entry.ring.filter((e) => e.seq > threshold);
        const gap = entry.droppedMaxSeq > threshold;
        const snapshot = {
            type: 'stream_resume',
            ...(entry.messageId ? { messageId: entry.messageId } : {}),
            ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
            content: entry.content,
            ...(entry.thinking ? { thinking: entry.thinking } : {}),
            finished: entry.finished,
            streamId: entry.streamId,
            /** 스냅샷이 반영한 마지막 순번 — 뒤이어 재생되는 이벤트는 이 이하일 수 있다(클라는 자기 afterSeq 기준으로 중복만 거른다) */
            lastSeq: entry.seq,
            ...(gap ? { gap: true } : {}),
            ...(entry.servedModel ? { servedModel: entry.servedModel } : {}),
        };
        try {
            ws.send(JSON.stringify(snapshot));
            for (const e of replay) ws.send(e.raw);
            entry.deliveredSeq = entry.seq;
        } catch (e) {
            log.warn('[WsStream] 재생 send 실패:', e);
        }
        log.info(`[WsStream] 스트림 재부착: key=${key} replayed=${replay.length} cursor=${useCursor ? threshold : 'none'} gap=${gap} content=${entry.content.length}자 finished=${entry.finished}`);
        if (this.ringMax <= 0) {
            entry.ring = [];
            entry.ringBytes = 0;
        }
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
        entry.ring = [];
        entry.ringBytes = 0;
        if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    }

    private clearTimer(entry: StreamEntry): void {
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    }
}

/**
 * 실제 응답 모델 알림(`served_model`) 발행기 — 값이 바뀔 때만 보낸다(provider gate 확정 1회 + 폴백 갱신).
 * 같은 값의 중복 콜백(요청 해석 단계가 여러 번 알려도)은 삼킨다.
 */
export function createServedModelEmitter(out: (payload: Record<string, unknown>) => void): (model: string) => void {
    let last: string | undefined;
    return (model: string): void => {
        if (!model || model === last) return;
        last = model;
        out({ type: 'served_model', model });
    };
}

let singleton: InFlightStreamRegistry | null = null;
export function getInFlightStreamRegistry(): InFlightStreamRegistry {
    if (!singleton) singleton = new InFlightStreamRegistry();
    return singleton;
}
