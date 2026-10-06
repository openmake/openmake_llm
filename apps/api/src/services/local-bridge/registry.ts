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
 *   - 서버→디바이스로 나가는 메시지는 두 가지 고정 형태뿐 — 임의 RPC 금지
 *       bridge_exec   : 도구 요청(kind 화이트리스트, reqId 로 결과 왕복)
 *       bridge_notice : 단방향 알림(notice 화이트리스트) — 디바이스는 표시만 하고 아무것도 실행하지 않는다
 *   - 비밀(토큰 등)은 프로토콜에 싣지 않는다
 *
 * @module services/local-bridge/registry
 */
import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import type { ExtendedWebSocket } from '../../sockets/ws-types';
import { LOCAL_BRIDGE } from '../../config/local-bridge';
import { createLogger } from '../../utils/logger';

const logger = createLogger('LocalBridge');

/** 서버→디바이스 도구 요청 종류 — 이 외의 kind 는 존재하지 않는다(임의 RPC 금지). */
export type BridgeKind = 'exec' | 'read' | 'write' | 'list' | 'listAll' | 'delete' | 'task_end' | 'worktree' | 'folders' | 'lsp_diagnostics' | 'code_nav' | 'test_runner' | 'browser';

/**
 * 능력 목록(bridge_hello.capabilities)을 보내지 않는 구버전 기기가 지원하는 것으로 보는 종류 — 2026-10-04 시점의 전체.
 * 이후 추가되는 종류는 여기에 넣지 않는다(구버전은 모른다 — 능력 목록에 있는 기기에만 보낸다).
 */
export const LEGACY_BRIDGE_KINDS: readonly BridgeKind[] = [
    'exec', 'read', 'write', 'list', 'listAll', 'delete', 'task_end', 'worktree', 'folders', 'lsp_diagnostics', 'code_nav', 'test_runner',
];

/**
 * 기기 능력 — 요청 종류에 더해, 요청 안의 추가 기능을 알리는 값.
 * browser_upload: browser 요청의 uploadFile 액션(2026-10-06) — 알리지 않는 기기에는 업로드를 보내지 않는다.
 */
export type BridgeCapability = BridgeKind | 'browser_upload';

/** 서버가 아는 능력 전체 — 기기가 보낸 능력 목록에서 이 밖의 값은 버린다. */
const KNOWN_BRIDGE_KINDS: ReadonlySet<string> = new Set<string>([...LEGACY_BRIDGE_KINDS, 'browser', 'browser_upload']);

/**
 * PURE: bridge_hello.capabilities → 지원 종류 집합. 배열이 아니면 undefined(구버전 — LEGACY_BRIDGE_KINDS 로 본다),
 * 배열이면 아는 종류만 남긴다(빈 배열 = 아무것도 지원하지 않음).
 */
export function normalizeCapabilities(raw: unknown): Set<BridgeCapability> | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out = new Set<BridgeCapability>();
    for (const v of raw) if (typeof v === 'string' && KNOWN_BRIDGE_KINDS.has(v)) out.add(v as BridgeCapability);
    return out;
}

/**
 * 서버→디바이스 단방향 알림 종류 — 디바이스 코어 NOTICE_KINDS 와 1:1.
 * approval_pending: 로컬 실행 작업이 도구 승인·ask_human 응답을 기다리며 멈췄다(컴패니언이 네이티브 알림).
 */
export type BridgeNoticeKind = 'approval_pending';

export interface BridgeNoticePayload {
    notice: BridgeNoticeKind;
    taskId: string;
    /** 표시 전용 — 디바이스가 제어문자·길이를 다시 정리한다. */
    toolName: string;
}

/** worktree 연산 — 서버는 op 만 지정하고 git 명령은 디바이스가 고정 인자로 조립한다(명령 주입 차단). */
export type WorktreeOp = 'add' | 'diff' | 'remove';

/** code_nav 연산 — grep(정규식 매치 줄) · files(파일별 줄 수). 그 외는 디바이스가 거절한다. */
export type CodeNavOp = 'grep' | 'files';

export interface BridgeRequestPayload {
    kind: BridgeKind;
    command?: string;
    path?: string;
    /** write 전용 — base64 본문 (바이너리 안전). */
    contentB64?: string;
    /** worktree·code_nav 전용 — 수행할 연산. */
    op?: WorktreeOp | CodeNavOp;
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
    /** lsp_diagnostics 전용 — 진단할 파일들(base 기준 상대경로). */
    paths?: string[];
    /** code_nav grep 전용 — 정규식 소스·글롭·대소문자·매치 상한(디바이스가 캡으로 다시 자른다). */
    pattern?: string;
    glob?: string;
    ignoreCase?: boolean;
    maxResults?: number;
    /** browser 전용(Companion P2) — 실행할 액션 배열(browser 도구의 액션 형식 그대로). */
    actions?: unknown[];
    /** browser 전용 — 사이트 허용 목록. 기기가 실제 탭 주소로 다시 판정한다. */
    sitePolicy?: { allow: string[]; deny: string[] };
    /** browser 전용 — 이번 호출에서 사용자가 승인한 호스트. */
    approvedHosts?: string[];
    /** browser 전용 — 이번 호출에서 사용자가 승인한 업로드(호스트·파일 목록). 기기가 같을 때만 실행한다(2026-10-06). */
    approvedUploads?: Array<{ host: string; files: string[] }>;
}

/** code_nav 결과 — 디바이스 코어 BridgeCodeNav 와 1:1. */
export interface BridgeCodeNavData {
    /** grep — "상대경로:줄번호:내용". */
    matches?: string[];
    /** files — 파일별 줄 수. */
    files?: { path: string; lines: number }[];
    /** 캡·시간 예산에 걸려 잘렸는지. */
    truncated?: boolean;
    /** 민감 파일 정책으로 건너뛴 파일 수. */
    skipped?: number;
}

/** 편집 후 진단 1건 — 디바이스의 컴파일러 출력(코어 BridgeDiagnostic 과 1:1). */
export interface BridgeDiagnostic {
    path: string;
    line: number;
    col: number;
    severity: 'error' | 'warning';
    code?: string;
    message: string;
    source: string;
}

export type BridgeTransportFailure = 'no_device' | 'send_failed' | 'timeout' | 'disconnected';

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
    /** lsp_diagnostics 결과 — 빈 배열은 "검사했고 문제 없음". */
    diagnostics?: BridgeDiagnostic[];
    /** 어떤 검사기가 돌았는지 — 'none' 이면 지원 도구가 없어 검사하지 않음(진단 0건과 구분). */
    serverKind?: string;
    /** code_nav 결과 — 없으면 구 디바이스(kind 미지원)로 보고 셸 경로로 폴백한다. */
    codeNav?: BridgeCodeNavData;
    /** test_runner 결과 — 'npm' | 'pytest' | 'go' | 'none'. 없으면 구 디바이스로 보고 셸 프로브로 폴백한다. */
    testRunner?: string;
    /** 서버가 채운다 — 기기의 능력 목록에 없는 종류라 보내지 않았다(기기는 아무것도 실행하지 않았다). */
    unsupported?: boolean;
    /**
     * 서버가 채운다 — 기기의 응답 없이 끝난 사유. no_device·send_failed 는 요청이 기기에 닿지 않았고(실행되지 않음),
     * timeout·disconnected 는 보낸 뒤 응답을 못 받았다(실행됐을 수 있다 — 쓰기·실행 계열은 결과 불명).
     */
    transport?: BridgeTransportFailure;
    /** 기기가 실행 전에 거절했다(코어 request-guard) — 만료·중복. 아무것도 실행하지 않았다. */
    rejected?: 'expired' | 'duplicate';
    /** browser — 사용자가 브라우저를 넘겨받은 상태라 기기가 아무것도 실행하지 않았다(2026-10-05, 구버전 기기는 싣지 않는다). */
    userControl?: boolean;
    /**
     * browser — 기기가 사이트 정책·사용자 제어로 막은 호출의 종류(코어 BrowserPolicyBlock, 2026-10-06). 감사 기록용.
     * 기기가 보낸 값이라 형태를 믿지 않는다(browser-policy-audit 가 검증). 구버전 기기는 싣지 않는다.
     */
    policyBlock?: { kind?: unknown; host?: unknown; action?: unknown };
}

export interface DeviceSession {
    userId: string;
    deviceId: string;
    /** 관측/영속용 라벨 (예: "MacBook-Pro · my-project") */
    label: string;
    folderName: string;
    /**
     * 이 연결이 속한 PC — 같은 PC 의 폴더(루트)별 연결이 같은 값을 갖는다. 상한은 이 단위로 센다.
     * 구버전 기기는 보내지 않으므로 register 가 deviceId 로 채운다(현행 계산과 동일).
     */
    hostId?: string;
    /** 기기가 지원한다고 알린 요청 종류. undefined = 구버전(LEGACY_BRIDGE_KINDS). */
    capabilities?: Set<BridgeCapability>;
    ws: WebSocket;
    connectedAt: number;
    /** 이 연결이 인증에 쓴 API key 의 id — 키를 삭제·비활성화·순환하면 disconnectByApiKey 로 닫는다. */
    apiKeyId?: string;
    /**
     * 기기가 마지막으로 알린 브라우저 제어권(bridge_event browser_control) — true 면 사용자가 넘겨받은 상태.
     * undefined = 알림을 받은 적 없음(구버전 기기 또는 연결 직후). 넘겨받기 주차의 재개 판단에만 쓴다.
     */
    browserUserControl?: boolean;
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
        session.hostId = session.hostId || session.deviceId;
        if (!prev) {
            // 상한은 PC(hostId) 단위 — 같은 PC 의 폴더별 연결은 1대로 세고, 한 PC 의 폴더 수는 따로 제한한다.
            const rootsByHost = new Map<string, number>();
            for (const s of byDevice.values()) rootsByHost.set(s.hostId ?? s.deviceId, (rootsByHost.get(s.hostId ?? s.deviceId) ?? 0) + 1);
            const hostRoots = rootsByHost.get(session.hostId) ?? 0;
            if (hostRoots === 0 && rootsByHost.size >= LOCAL_BRIDGE.MAX_DEVICES) {
                logger.warn(`[Bridge] 디바이스 상한 초과 거부: user=${session.userId} device=${session.deviceId} host=${session.hostId} (max=${LOCAL_BRIDGE.MAX_DEVICES})`);
                return false;
            }
            if (hostRoots >= LOCAL_BRIDGE.MAX_ROOTS_PER_HOST) {
                logger.warn(`[Bridge] PC 당 폴더 상한 초과 거부: user=${session.userId} host=${session.hostId} (max=${LOCAL_BRIDGE.MAX_ROOTS_PER_HOST})`);
                return false;
            }
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

    /** 모든 사용자의 접속 디바이스 (관리자 조회용, 사용자·접속 순). */
    listAllDevices(): DeviceSession[] {
        const out: DeviceSession[] = [];
        for (const userId of this.devices.keys()) out.push(...this.getDevices(userId));
        return out;
    }

    /**
     * 디바이스 강제 해제 — 소켓을 닫고 레지스트리에서 바로 뺀다(close 이벤트를 기다리지 않는다:
     * 응답 직후의 조회에 남지 않게). 없는 디바이스면 false.
     */
    disconnectDevice(userId: string, deviceId: string, reason: string): boolean {
        const dev = this.devices.get(userId)?.get(deviceId);
        if (!dev) return false;
        this.unregister(dev.ws);
        try { dev.ws.close(1008, reason); } catch { /* already closing */ }
        return true;
    }

    /** 이 API key 로 인증한 브리지 연결을 모두 닫는다(키 삭제·비활성화·순환). 닫은 수를 돌려준다. */
    disconnectByApiKey(apiKeyId: string): number {
        const targets = this.listAllDevices().filter((s) => s.apiKeyId === apiKeyId);
        for (const s of targets) this.disconnectDevice(s.userId, s.deviceId, 'api_key_revoked');
        if (targets.length > 0) logger.info(`[Bridge] API key 폐기로 연결 ${targets.length}개 종료: key=${apiKeyId}`);
        return targets.length;
    }

    /** 이 사용자의 브리지 연결을 모두 닫는다(계정 비활성화·삭제 — 관리자 강제 해제와 사유를 나눈다). 닫은 수를 돌려준다. */
    disconnectByUser(userId: string, reason: 'account_disabled' | 'account_deleted'): number {
        const targets = this.getDevices(userId);
        for (const s of targets) this.disconnectDevice(s.userId, s.deviceId, reason);
        if (targets.length > 0) logger.info(`[Bridge] 계정 상태 변경(${reason})으로 연결 ${targets.length}개 종료: user=${userId}`);
        return targets.length;
    }

    /**
     * 키 만료일 변경을 이 키로 인증한 연결에 반영한다(null = 무기한). 연결의 만료 시각은 WS 인증 때 한 번 정해지고
     * 하트비트(sockets/handler.ts)가 그 값이 지난 연결을 닫으므로, 바뀐 값을 넣어 두면 새 만료 시각에 닫힌다. 바꾼 수를 돌려준다.
     */
    updateApiKeyExpiry(apiKeyId: string, expiresAtMs: number | null): number {
        const targets = this.listAllDevices().filter((s) => s.apiKeyId === apiKeyId);
        for (const s of targets) (s.ws as ExtendedWebSocket)._authTokenExpiresAtMs = expiresAtMs;
        return targets.length;
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

    /** 이 기기가 요청 종류를 지원하는가 — 연결돼 있지 않으면 false. 능력 목록이 없는 구버전은 현행 종류만. */
    supports(userId: string, deviceId: string | undefined, kind: BridgeCapability): boolean {
        const dev = this.getDevice(userId, deviceId);
        if (!dev) return false;
        return dev.capabilities ? dev.capabilities.has(kind) : (LEGACY_BRIDGE_KINDS as readonly string[]).includes(kind);
    }

    /** 도구 1회 왕복. 타임아웃/연결단절 시 ok=false 결과로 해소(throw 하지 않음 — 도구 오류로 전달). */
    request(userId: string, payload: BridgeRequestPayload, timeoutMs = LOCAL_BRIDGE.REQUEST_TIMEOUT_MS, deviceId?: string): Promise<BridgeResult> {
        const dev = this.getDevice(userId, deviceId);
        if (!dev || dev.ws.readyState !== dev.ws.OPEN) {
            return Promise.resolve({ ok: false, transport: 'no_device', error: '연결된 로컬 디바이스가 없습니다 — 데스크톱 앱 또는 CLI 로 작업 폴더를 연결하세요.' });
        }
        if (!this.supports(userId, dev.deviceId, payload.kind)) {
            return Promise.resolve({ ok: false, unsupported: true, error: `이 디바이스는 '${payload.kind}' 요청을 지원하지 않습니다 — Companion 또는 CLI 를 업데이트하세요.` });
        }
        const reqId = randomUUID();
        return new Promise<BridgeResult>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(reqId);
                resolve({ ok: false, transport: 'timeout', error: `로컬 실행 응답 시간 초과 (${Math.round(timeoutMs / 1000)}s)` });
            }, timeoutMs);
            this.pending.set(reqId, { resolve, timer, userId, deviceId: dev.deviceId });
            try {
                // expiresAt: 서버가 응답을 포기하는 시점 — 그 뒤에 도착한 요청을 기기가 실행하지 않게 한다(구버전 기기는 무시).
                dev.ws.send(JSON.stringify({ type: 'bridge_exec', reqId, ...payload, expiresAt: Date.now() + timeoutMs }));
            } catch (e) {
                clearTimeout(timer);
                this.pending.delete(reqId);
                resolve({ ok: false, transport: 'send_failed', error: `브리지 전송 실패: ${e instanceof Error ? e.message : String(e)}` });
            }
        });
    }

    /**
     * 단방향 알림 — 응답을 기다리지 않는다(fire-and-forget). 라우팅은 request() 와 같다(deviceId 지정 시
     * 정확 일치, 미지정은 최근 접속 디바이스). 프레임엔 화이트리스트 필드만 싣는다. 보냈으면 true,
     * 디바이스 없음·닫힌 소켓·전송 예외는 false(throw 하지 않음 — 알림 실패가 작업을 흔들지 않게).
     */
    notify(userId: string, payload: BridgeNoticePayload, deviceId?: string): boolean {
        const dev = this.getDevice(userId, deviceId);
        if (!dev || dev.ws.readyState !== dev.ws.OPEN) return false;
        try {
            dev.ws.send(JSON.stringify({ type: 'bridge_notice', notice: payload.notice, taskId: payload.taskId, toolName: payload.toolName }));
            return true;
        } catch (e) {
            logger.warn(`[Bridge] 알림 전송 실패: user=${userId} device=${dev.deviceId} ${e instanceof Error ? e.message : String(e)}`);
            return false;
        }
    }

    /** 브라우저 제어권 알림 기록 — 그 소켓으로 등록된 연결에만 남긴다(등록 전이면 무시). */
    setBrowserUserControl(userId: string, ws: WebSocket, user: boolean): void {
        for (const s of this.devices.get(userId)?.values() ?? []) if (s.ws === ws) s.browserUserControl = user;
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
                p.resolve({ ok: false, transport: 'disconnected', error: reason });
            }
        }
    }
}

let instance: LocalBridgeRegistry | null = null;
export function getLocalBridgeRegistry(): LocalBridgeRegistry {
    if (!instance) instance = new LocalBridgeRegistry();
    return instance;
}
