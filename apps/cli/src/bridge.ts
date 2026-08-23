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

/** 터미널 confirm 어댑터 시그니처 — 코어 계약을 그대로 재노출 (index.ts 하위호환). */
export type ConfirmFn = CoreConfirmFn;

export interface BridgeOptions {
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

    constructor(opts: BridgeOptions) {
        const core = new BridgeCore({
            folder: opts.folder,
            confirm: opts.confirm,
            sandboxProfileDir: os.tmpdir(),
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
            ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
        });
    }

    connect(): void { void this.connection.connect(); }
    disconnect(): void { this.connection.disconnect(); }
}
