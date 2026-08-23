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
export type BridgeKind = 'exec' | 'read' | 'write' | 'list' | 'listAll' | 'delete' | 'task_end' | 'worktree' | 'folders';

/** worktree 연산 — 서버는 op 만 지정하고 git 명령은 디바이스가 고정 인자로 조립한다(명령 주입 차단). */
export type WorktreeOp = 'add' | 'diff' | 'remove';

export interface BridgeRequestPayload {
    kind: BridgeKind;
    command?: string;
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
    /**
     * 폴더 선택(2026-08-21) — 연결 루트 기준 상대경로. exec cwd·파일 경로·worktree base 를
     * 이 하위 폴더로 재지정한다. 웹 입력은 **작업 생성 시점**에 isEnumeratedFolder 로 검증
     * (디바이스가 folders 응답으로 스스로 보고한 값만 — 웹발 임의 경로 차단)하고, 여기서
     * 재검증하지 않는다(디바이스 재접속 시 세션 캐시가 리셋돼 실행 중 작업이 깨짐).
     * 디바이스가 기존 safe()(realpath, 루트 탈출 차단)로 항상 재검증한다. 미지정=루트.
     */
    folder?: string;
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
    /** folders 결과 — 열거 상한 초과로 목록이 절단됐으면 true. */
    truncated?: boolean;
}

export interface DeviceSession {
    userId: string;
    deviceId: string;
    /** 관측/영속용 라벨 (예: "MacBook-Pro · my-project") */
    label: string;
    folderName: string;
    ws: WebSocket;
    connectedAt: number;
    /**
     * 폴더 선택 세션 캐시 — 이 디바이스가 folders 응답으로 스스로 열거·보고한 루트 기준
     * 상대경로 집합('' = 루트). 작업 생성·bridge_exec 의 folder 값은 이 집합에 있어야만
     * 디바이스로 내려간다(디바이스 발원 검증). WS 세션과 수명을 같이한다.
     */
    enumeratedFolders?: Set<string>;
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
            // 구 소켓을 능동 종료 — 방치하면 unregister 가 새 ws 만 매칭해 구 ws 는 유휴로 남는다.
            try { prev.ws.close(1000, 'device_reregistered'); } catch { /* already closing */ }
        }
        // 루트('')는 항상 유효 — 열거 캐시는 등록 시점에 리셋(재연결 시 다른 루트일 수 있음).
        session.enumeratedFolders = new Set(['']);
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

    /** folders 응답 수신 시 열거 캐시 병합 — 이후 folder 지정 요청·작업 생성의 검증 근거. */
    noteEnumeratedFolders(userId: string, deviceId: string, rels: string[]): void {
        const dev = this.devices.get(userId)?.get(deviceId);
        if (!dev) return;
        dev.enumeratedFolders ??= new Set(['']);
        for (const rel of rels) dev.enumeratedFolders.add(rel);
    }

    /** folder 값이 이 디바이스가 스스로 보고한 폴더인지 검증 ('' 또는 미지정 = 루트, 항상 유효). */
    isEnumeratedFolder(userId: string, deviceId: string, rel: string | undefined): boolean {
        if (!rel) return true;
        return this.devices.get(userId)?.get(deviceId)?.enumeratedFolders?.has(rel) ?? false;
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

    /** ws 소켓에 해당하는 디바이스 id (없으면 null) — bridge_result 발신자 검증용. */
    getDeviceIdByWs(userId: string, ws: WebSocket): string | null {
        const byDevice = this.devices.get(userId);
        if (!byDevice) return null;
        for (const [deviceId, s] of byDevice) if (s.ws === ws) return deviceId;
        return null;
    }

    /**
     * bridge_result 수신 — reqId 상관관계 해소. 소유 userId 불일치는 무시(교차 주입 차단).
     * senderDeviceId 지정 시 요청을 라우팅한 디바이스와 일치하는지도 검증한다(같은 유저의
     * 다른 디바이스가 결과를 위조 주입하는 것 차단 — rejectPendingFor 의 deviceId 격리와 대칭).
     */
    handleResult(userId: string, reqId: string, result: BridgeResult, senderDeviceId?: string): void {
        const p = this.pending.get(reqId);
        if (!p) return; // 이미 타임아웃/해소됨
        if (p.userId !== userId) {
            logger.warn(`[Bridge] reqId 소유 불일치 무시: req=${reqId} owner=${p.userId} sender=${userId}`);
            return;
        }
        if (senderDeviceId && p.deviceId && senderDeviceId !== p.deviceId) {
            logger.warn(`[Bridge] reqId 디바이스 불일치 무시: req=${reqId} routed=${p.deviceId} sender=${senderDeviceId}`);
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
