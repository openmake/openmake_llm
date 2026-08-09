/**
 * ============================================================
 * Local Bridge Registry — 디바이스 연결 레지스트리 (Cowork D1a)
 * ============================================================
 *
 * 채팅 WS 로 접속한 브리지 클라이언트(데스크톱 앱)를 userId 별로 1대 등록하고,
 * RemoteExecutor 의 도구 호출을 reqId 상관관계로 왕복시킨다.
 *
 * in-memory 싱글턴 (steering 레지스트리 관행) — 멀티프로세스 확장 시 Redis 이전.
 *
 * 보안:
 *   - 등록은 인증된 WS(_authenticatedUserId)에서만 (handler.ts 가 보장)
 *   - 서버→디바이스로 나가는 메시지는 bridge_exec 고정 형태만 — 임의 RPC 금지
 *   - 비밀(토큰 등)은 프로토콜에 싣지 않는다
 *
 * @module services/local-bridge/registry
 */
import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import { LOCAL_BRIDGE } from '../../config/local-bridge';
import { createLogger } from '../../utils/logger';

const logger = createLogger('LocalBridge');

/** 서버→디바이스 도구 요청 종류 — 이 외의 kind 는 존재하지 않는다(임의 RPC 금지). */
export type BridgeKind = 'exec' | 'read' | 'write' | 'list' | 'listAll' | 'delete' | 'task_end' | 'browser' | 'worktree';

/** worktree 연산 — 서버는 op 만 지정하고 git 명령은 디바이스가 고정 인자로 조립한다(명령 주입 차단). */
export type WorktreeOp = 'add' | 'diff' | 'remove';

export interface BridgeRequestPayload {
    kind: BridgeKind;
    command?: string;
    /** browser 전용 — 액션 spec({actions,allowlist,timeoutMs}). 데스크톱이 내장 Chromium 으로 실행. */
    spec?: Record<string, unknown>;
    path?: string;
    /** write 전용 — base64 본문 (바이너리 안전). */
    contentB64?: string;
    /** worktree 전용 — 수행할 연산. */
    op?: WorktreeOp;
    /** worktree 전용 — task 식별자(디렉토리·브랜치명 파생). 디바이스가 형식을 재검증한다. */
    taskId?: string;
}

/** 디바이스가 돌려주는 결과 (bridge_result). */
export interface BridgeResult {
    ok: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    /** read 결과 (utf8) */
    content?: string;
    /** list/listAll 결과 */
    entries?: string[];
    error?: string;
    durationMs?: number;
    /** worktree add 결과 — 연결 폴더 기준 상대경로(서버는 이 prefix 로 파일·exec 를 라우팅). */
    worktreeRel?: string;
    /** worktree add 결과 — 생성된 작업 브랜치명(사용자 안내용). */
    branch?: string;
    /** worktree remove 결과 — 변경분이 남아 보존했으면 true. */
    kept?: boolean;
}

export interface DeviceSession {
    userId: string;
    deviceId: string;
    /** 관측/영속용 라벨 (예: "MacBook-Pro · my-project") */
    label: string;
    folderName: string;
    ws: WebSocket;
    connectedAt: number;
}

interface Pending {
    resolve: (r: BridgeResult) => void;
    timer: NodeJS.Timeout;
    userId: string;
}

class LocalBridgeRegistry {
    /** userId → 세션 (유저당 1대 — 새 등록이 기존을 대체). */
    private readonly devices = new Map<string, DeviceSession>();
    private readonly pending = new Map<string, Pending>();

    register(session: DeviceSession): void {
        const prev = this.devices.get(session.userId);
        if (prev && prev.ws !== session.ws) {
            logger.info(`[Bridge] 기존 디바이스 대체: user=${session.userId} ${prev.label} → ${session.label}`);
            this.rejectPendingFor(session.userId, '다른 디바이스가 연결되어 세션이 대체되었습니다');
        }
        this.devices.set(session.userId, session);
        logger.info(`[Bridge] 디바이스 등록: user=${session.userId} device=${session.deviceId} label="${session.label}" folder="${session.folderName}"`);
    }

    /** WS 종료 시 호출 — 이 소켓이 현재 등록 세션이면 해제 + pending 전부 reject. */
    unregister(ws: WebSocket): void {
        for (const [userId, s] of this.devices) {
            if (s.ws === ws) {
                this.devices.delete(userId);
                this.rejectPendingFor(userId, '디바이스 연결이 끊어졌습니다');
                logger.info(`[Bridge] 디바이스 해제: user=${userId} label="${s.label}"`);
                return;
            }
        }
    }

    getDevice(userId: string): DeviceSession | null {
        return this.devices.get(userId) ?? null;
    }

    /** 도구 1회 왕복. 타임아웃/연결단절 시 ok=false 결과로 해소(throw 하지 않음 — 도구 오류로 전달). */
    request(userId: string, payload: BridgeRequestPayload, timeoutMs = LOCAL_BRIDGE.REQUEST_TIMEOUT_MS): Promise<BridgeResult> {
        const dev = this.devices.get(userId);
        if (!dev || dev.ws.readyState !== dev.ws.OPEN) {
            return Promise.resolve({ ok: false, error: '연결된 로컬 디바이스가 없습니다 — 데스크톱 앱에서 폴더를 연결하세요.' });
        }
        const reqId = randomUUID();
        return new Promise<BridgeResult>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(reqId);
                resolve({ ok: false, error: `로컬 실행 응답 시간 초과 (${Math.round(timeoutMs / 1000)}s)` });
            }, timeoutMs);
            this.pending.set(reqId, { resolve, timer, userId });
            try {
                dev.ws.send(JSON.stringify({ type: 'bridge_exec', reqId, ...payload }));
            } catch (e) {
                clearTimeout(timer);
                this.pending.delete(reqId);
                resolve({ ok: false, error: `브리지 전송 실패: ${e instanceof Error ? e.message : String(e)}` });
            }
        });
    }

    /** bridge_result 수신 — reqId 상관관계 해소. 소유 userId 불일치는 무시(교차 주입 차단). */
    handleResult(userId: string, reqId: string, result: BridgeResult): void {
        const p = this.pending.get(reqId);
        if (!p) return; // 이미 타임아웃/해소됨
        if (p.userId !== userId) {
            logger.warn(`[Bridge] reqId 소유 불일치 무시: req=${reqId} owner=${p.userId} sender=${userId}`);
            return;
        }
        clearTimeout(p.timer);
        this.pending.delete(reqId);
        p.resolve(result);
    }

    private rejectPendingFor(userId: string, reason: string): void {
        for (const [reqId, p] of this.pending) {
            if (p.userId === userId) {
                clearTimeout(p.timer);
                this.pending.delete(reqId);
                p.resolve({ ok: false, error: reason });
            }
        }
    }
}

let instance: LocalBridgeRegistry | null = null;
export function getLocalBridgeRegistry(): LocalBridgeRegistry {
    if (!instance) instance = new LocalBridgeRegistry();
    return instance;
}
