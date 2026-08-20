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
    /**
     * task 식별자. worktree(디렉토리·브랜치명 파생, 디바이스가 형식 재검증)와 exec·task_end
     * (디바이스의 **작업 단위 일괄 승인** 범위 식별)에 쓰인다.
     */
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
    deviceId: string;
}

class LocalBridgeRegistry {
    /**
     * userId → (deviceId → 세션). 유저당 여러 디바이스 병존(데스크톱+CLI, 상한 MAX_DEVICES) —
     * 같은 deviceId 재등록은 기존 세션을 대체한다(구 1대 정책의 의미 유지).
     */
    private readonly devices = new Map<string, Map<string, DeviceSession>>();
    private readonly pending = new Map<string, Pending>();

    /** 등록. 디바이스 상한 초과 시 false (호출부가 오류 응답). */
    register(session: DeviceSession): boolean {
        let byDevice = this.devices.get(session.userId);
        if (!byDevice) {
            byDevice = new Map();
            this.devices.set(session.userId, byDevice);
        }
        const prev = byDevice.get(session.deviceId);
        if (!prev && byDevice.size >= LOCAL_BRIDGE.MAX_DEVICES) {
            logger.warn(`[Bridge] 디바이스 상한 초과 거부: user=${session.userId} device=${session.deviceId} (max=${LOCAL_BRIDGE.MAX_DEVICES})`);
            return false;
        }
        if (prev && prev.ws !== session.ws) {
            logger.info(`[Bridge] 동일 디바이스 재등록 대체: user=${session.userId} ${prev.label} → ${session.label}`);
            this.rejectPendingFor(session.userId, session.deviceId, '디바이스가 재연결되어 세션이 대체되었습니다');
        }
        byDevice.set(session.deviceId, session);
        logger.info(`[Bridge] 디바이스 등록: user=${session.userId} device=${session.deviceId} label="${session.label}" folder="${session.folderName}" (${byDevice.size}대)`);
        return true;
    }

    /** WS 종료 시 호출 — 이 소켓의 세션만 해제 + 그 디바이스의 pending 만 reject. */
    unregister(ws: WebSocket): void {
        for (const [userId, byDevice] of this.devices) {
            for (const [deviceId, s] of byDevice) {
                if (s.ws === ws) {
                    byDevice.delete(deviceId);
                    if (byDevice.size === 0) this.devices.delete(userId);
                    this.rejectPendingFor(userId, deviceId, '디바이스 연결이 끊어졌습니다');
                    logger.info(`[Bridge] 디바이스 해제: user=${userId} device=${deviceId} label="${s.label}"`);
                    return;
                }
            }
        }
    }

    /**
     * 디바이스 조회. deviceId 지정 시 정확 일치, 미지정(구 계약)은 가장 최근 접속 디바이스
     * — 1대 운용이던 기존 동작과 동일하고, 다대 접속 시에도 결정적이다.
     */
    getDevice(userId: string, deviceId?: string): DeviceSession | null {
        const byDevice = this.devices.get(userId);
        if (!byDevice || byDevice.size === 0) return null;
        if (deviceId) return byDevice.get(deviceId) ?? null;
        let latest: DeviceSession | null = null;
        for (const s of byDevice.values()) {
            if (!latest || s.connectedAt > latest.connectedAt) latest = s;
        }
        return latest;
    }

    /** 유저의 접속 디바이스 전체 (접속 순 정렬 — status API 노출용). */
    getDevices(userId: string): DeviceSession[] {
        const byDevice = this.devices.get(userId);
        if (!byDevice) return [];
        return [...byDevice.values()].sort((a, b) => a.connectedAt - b.connectedAt);
    }

    /** 도구 1회 왕복. 타임아웃/연결단절 시 ok=false 결과로 해소(throw 하지 않음 — 도구 오류로 전달). */
    request(userId: string, payload: BridgeRequestPayload, timeoutMs = LOCAL_BRIDGE.REQUEST_TIMEOUT_MS, deviceId?: string): Promise<BridgeResult> {
        const dev = this.getDevice(userId, deviceId);
        if (!dev || dev.ws.readyState !== dev.ws.OPEN) {
            return Promise.resolve({ ok: false, error: '연결된 로컬 디바이스가 없습니다 — 데스크톱 앱 또는 CLI 로 작업 폴더를 연결하세요.' });
        }
        const reqId = randomUUID();
        return new Promise<BridgeResult>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(reqId);
                resolve({ ok: false, error: `로컬 실행 응답 시간 초과 (${Math.round(timeoutMs / 1000)}s)` });
            }, timeoutMs);
            this.pending.set(reqId, { resolve, timer, userId, deviceId: dev.deviceId });
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

    private rejectPendingFor(userId: string, deviceId: string, reason: string): void {
        for (const [reqId, p] of this.pending) {
            if (p.userId === userId && p.deviceId === deviceId) {
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
