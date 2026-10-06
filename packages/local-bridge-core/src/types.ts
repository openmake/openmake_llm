/**
 * 로컬 브리지 프로토콜 타입 — 서버 apps/api/src/services/local-bridge/ (D1a) 와 1:1.
 * 데스크톱 컴패니언 헬퍼 · CLI apps/cli 가 공유한다 (2026-08-22 코어 추출 — 축2 plan 1단계).
 */

export interface BridgeMsg {
    type?: string;
    kind?: string;
    reqId?: string;
    command?: string;
    path?: string;
    contentB64?: string;
    op?: string;
    taskId?: string;
    message?: string;
    /** 폴더 선택 — 연결 루트 기준 상대경로. exec cwd·파일 경로·worktree base 재지정. */
    folder?: string;
    /** lsp_diagnostics — 진단할 파일들(base 기준 상대경로). */
    paths?: string[];
    /** code_nav grep — 정규식 소스(디바이스가 길이 검증 후 컴파일). */
    pattern?: string;
    /** code_nav grep — 파일 글롭 필터('*.ts' 처럼 '/' 가 없으면 파일명에만 적용). */
    glob?: string;
    /** code_nav grep — 대소문자 무시. */
    ignoreCase?: boolean;
    /** code_nav grep — 매치 상한(디바이스 캡으로 다시 잘린다). */
    maxResults?: number;
    /** browser — 실행할 액션 배열(서버 browser 도구의 액션 형식 그대로). */
    actions?: unknown;
    /** browser — 사이트 허용 목록(@openmake/config BrowserSitePolicy). 기기가 실제 탭 주소로 다시 판정한다. */
    sitePolicy?: unknown;
    /** browser — 이번 호출에서 사용자가 승인한 호스트. */
    approvedHosts?: unknown;
    /** bridge_exec — 이 시각(epoch ms)이 지나면 실행하지 않는다. 없으면(구버전 서버) 검사하지 않는다. */
    expiresAt?: number;
    /** bridge_notice — 알림 종류(NOTICE_KINDS 화이트리스트). */
    notice?: string;
    /** bridge_notice approval_pending — 승인을 기다리는 도구 이름(표시 전용, 서버 발 텍스트). */
    toolName?: string;
}

/** code_nav 결과 — 읽기 전용 코드 탐색(grep/files)의 공통 표현. */
export interface BridgeCodeNav {
    /** grep — "상대경로:줄번호:내용" 형태의 매치 줄. */
    matches?: string[];
    /** files — 파일별 줄 수(base 기준 상대경로). */
    files?: { path: string; lines: number }[];
    /** 캡·시간 예산에 걸려 결과가 잘렸는지. */
    truncated?: boolean;
    /** 민감 파일 정책으로 건너뛴 파일 수 — 0 이면 생략. 모델이 "없음"으로 오판하지 않게 노출한다. */
    skipped?: number;
}

/** 편집 후 진단 1건 — 컴파일러/언어 서버 출력의 공통 표현. */
export interface BridgeDiagnostic {
    /** base 기준 상대경로(POSIX 구분자). */
    path: string;
    line: number;
    col: number;
    severity: 'error' | 'warning';
    /** 진단 코드(TS2322 등) — 있으면. */
    code?: string;
    message: string;
    /** 어느 도구가 냈는지 — 'tsc' | 'py_compile' … */
    source: string;
}

export interface BridgeResult {
    ok: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    content?: string;
    entries?: string[];
    error?: string;
    durationMs?: number;
    worktreeRel?: string;
    branch?: string;
    kept?: boolean;
    truncated?: boolean;
    /** lsp_diagnostics 결과. 빈 배열 = 진단 없음(도구가 돌았고 문제가 없었다). */
    diagnostics?: BridgeDiagnostic[];
    /** 어떤 검사기가 돌았는지 — 'none' 이면 지원 도구가 없어 검사하지 않았다(진단 없음과 구분). */
    serverKind?: string;
    /** code_nav 결과. */
    codeNav?: BridgeCodeNav;
    /** test_runner 결과 — 'npm' | 'pytest' | 'go' | 'none'. */
    testRunner?: string;
    /** 실행 전에 거절했다(request-guard.ts) — 아무것도 실행하지 않았다. */
    rejected?: 'expired' | 'duplicate';
    /** browser — 사용자가 브라우저를 넘겨받은 상태라 아무것도 실행하지 않았다(서버가 작업을 주차한다). 구버전 서버는 무시한다. */
    userControl?: boolean;
    /** browser — 기기가 사이트 정책·사용자 제어로 막은 호출의 종류(서버 감사 기록용, 2026-10-06). 한 호출에 하나. 구버전 서버는 무시한다. */
    policyBlock?: BrowserPolicyBlock;
}

/**
 * 기기가 막은 브라우저 호출 — site_off_list: 허용 목록 밖 사이트의 쓰기·누르기(질의 문자열을 실은 이동 포함),
 * site_denied: 거부 목록 사이트, blocked_url: http(s) 가 아닌 주소로의 이동, user_control: 사용자가 넘겨받은 상태.
 * host 는 호스트 이름만(주소 전체·입력 내용은 싣지 않는다), 알 수 없으면 null. action 은 막힌 액션의 종류(goto·fill …).
 */
export type BrowserPolicyBlockKind = 'site_off_list' | 'site_denied' | 'blocked_url' | 'user_control';

export interface BrowserPolicyBlock {
    kind: BrowserPolicyBlockKind;
    host: string | null;
    action: string;
}

/**
 * 서버→디바이스 단방향 알림 — BridgeConnection 이 검증한 것만 호스트(onNotice)로 넘어간다.
 * approval_pending: 로컬 실행 작업이 도구 승인·ask_human 응답을 기다리며 멈췄다.
 * 디바이스는 표시만 한다(아무것도 실행하지 않는다 — 임의 RPC 금지).
 */
export interface BridgeNotice {
    notice: 'approval_pending';
    taskId: string;
    toolName: string;
}

/**
 * 연결 상태 코드 — onStatus 의 두 번째 인자. 상태 텍스트는 한국어 고정이라 호스트가 다국어로
 * 보여 줄 때 이 코드를 쓴다(세 번째 인자 arg = 폴더명·서버 메시지 등 치환값).
 */
export type BridgeStatusCode = 'connecting' | 'connected' | 'server_error' | 'reconnecting' | 'closed' | 'idle' | 'auth_error' | BridgeAuthCloseReason;

/**
 * 서버가 인증 문제로 연결을 닫은 사유(닫는 코드 1008 의 reason) — 상태 코드로도 그대로 쓴다(2026-10-06).
 * 키 폐기(삭제·비활성화·순환)·만료·비활성·없음, 계정 비활성·삭제, bridge 스코프 없음. 다시 연결해도 같은 결과다.
 */
export type BridgeAuthCloseReason = 'api_key_revoked' | 'api_key_invalid' | 'api_key_expired' | 'api_key_inactive'
    | 'account_disabled' | 'account_deleted' | 'bridge_scope_required';

/**
 * confirmExec 어댑터 — 실행 전 사용자 확인(비우회 게이트)의 호스트 구현.
 * 데스크톱 = dialog 3버튼, CLI = 터미널 y/a/n. 비대화형은 'no'(fail-safe).
 * 'all' 은 **그 작업 동안만** 일괄 승인 — 회수(task_end·연결 해제)는 코어가 관리한다.
 */
export type ConfirmFn = (command: string, taskId: string | undefined, folderRoot: string) => Promise<'yes' | 'all' | 'no'>;

export interface BridgeCoreOptions {
    /** 연결 폴더 — 코어가 realpath 로 확정한다. */
    folder: string;
    /** exec 실행 전 사용자 확인 (비우회). */
    confirm: ConfirmFn;
    /** sandbox-exec 프로파일 파일을 둘 디렉토리 (데스크톱=userData, CLI=tmpdir). */
    sandboxProfileDir: string;
    /** task_end 시 호스트 정리 훅. */
    onTaskEnd?: (taskId: string | undefined) => void;
    /** 일괄 승인 집합 변경 알림 (데스크톱=메뉴 라벨 갱신). */
    onAutoApproveChange?: () => void;
    /**
     * 로컬 브라우저 전용 프로필 디렉토리 — 주면 browser 요청을 처리한다(Chrome 이 있을 때). 없으면 브라우저 미지원.
     * 사용자의 평소 Chrome 프로필이 아닌 **별도 디렉토리**여야 한다(호스트가 앱 데이터 폴더 아래에 만든다).
     */
    browserProfileDir?: string;
    /** 테스트/비대화형 훅 — confirm 없이 전부 승인 (OMK_BRIDGE_AUTO_APPROVE=1 과 동일 계열). */
    autoApproveAll?: boolean;
}
