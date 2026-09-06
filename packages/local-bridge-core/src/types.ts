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
}

/** code_nav 결과 — 읽기 전용 코드 탐색(grep/files)의 공통 표현. */
export interface BridgeCodeNav {
    /** grep — "상대경로:줄번호:내용" 형태의 매치 줄. */
    matches?: string[];
    /** files — 파일별 줄 수(base 기준 상대경로). */
    files?: { path: string; lines: number }[];
    /** 캡·시간 예산에 걸려 결과가 잘렸는지. */
    truncated?: boolean;
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
}

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
    /** 테스트/비대화형 훅 — confirm 없이 전부 승인 (OMK_BRIDGE_AUTO_APPROVE=1 과 동일 계열). */
    autoApproveAll?: boolean;
}
