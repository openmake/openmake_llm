/**
 * OpenMake Code CLI 브리지 — @openmake/local-bridge-core 의 CLI 어댑터.
 *
 * 프로토콜·경로 스코프·exec 3단 방어·worktree 격리는 전부 코어 패키지가 담당한다
 * (2026-08-22 코어 추출 — 종전에는 데스크톱 bridge.js 의 이식 복제본 415줄이 여기 있었다).
 * CLI 가 주입하는 호스트 차이만 남는다:
 *   - 인증: API key(omk_live_*) Authorization 헤더
 *   - confirmExec: 터미널 y/a/n 프롬프트 (index.ts 의 ConfirmFn)
 *   - sandbox 프로파일 위치: tmpdir
 */
import * as os from 'os';
import * as path from 'path';
import { BridgeConnection, BridgeCore, type ConfirmFn as CoreConfirmFn } from '@openmake/local-bridge-core';
import { deviceId } from './config';
import { RegistrationWatch, type RegisterOutcome } from './register-wait';

/** 터미널 confirm 어댑터 시그니처 — 코어 계약을 그대로 재노출 (index.ts 하위호환). */
export type ConfirmFn = CoreConfirmFn;

interface BridgeOptions {
    serverUrl: string;
    apiKey: string;
    /** 연결 폴더(단일) — 서버는 디바이스당 폴더 하나만 지원한다. */
    folder: string;
    confirm: ConfirmFn;
    onStatus?: (s: string) => void;
    autoApproveAll?: boolean; // 테스트/비대화형 훅
}

export class CliBridge {
    private readonly connection: BridgeConnection;
    /** 자기 소켓의 등록 결과 — 연결을 시작하기 전부터 상태를 받아 둔다(run·resume 의 성공 판정, 2026-11-19). */
    private readonly registration = new RegistrationWatch();

    constructor(opts: BridgeOptions) {
        const core = new BridgeCore({
            folder: opts.folder,
            confirm: opts.confirm,
            sandboxProfileDir: os.tmpdir(),
            // 로컬 브라우저(P2) — OMK_BRIDGE_BROWSER=1 로 켠다. 전용 프로필은 ~/.openmake 아래(평소 Chrome 프로필이 아니다).
            ...(process.env.OMK_BRIDGE_BROWSER === '1' ? { browserProfileDir: path.join(os.homedir(), '.openmake', 'browser-profile') } : {}),
            ...(opts.autoApproveAll !== undefined ? { autoApproveAll: opts.autoApproveAll } : {}),
        });
        this.connection = new BridgeConnection({
            serverUrl: opts.serverUrl,
            core,
            deviceId: deviceId(),
            label: `${os.hostname()} · ${path.basename(core.folderRoot)}`,
            // 네이티브 클라이언트라 Origin 헤더를 보내지 않는다 — 인증은 API key(헤더). 서버는
            // API key 요청에 한해 Origin 검증을 면제한다(CSWSH 는 쿠키 기반 브라우저 공격).
            headers: () => ({ Authorization: `Bearer ${opts.apiKey}` }),
            onStatus: (s, code, arg) => { this.registration.note(s, code, arg); opts.onStatus?.(s); },
        });
    }

    connect(): void { void this.connection.connect(); }
    /** 자기 소켓이 bridge_ready 를 받을 때까지(또는 충돌·인증 실패) 기다린다. 시간이 다 되면 timeout. */
    waitRegistered(timeoutMs: number): Promise<RegisterOutcome> { return this.registration.wait(timeoutMs); }
    disconnect(): void { this.connection.disconnect(); }
}
