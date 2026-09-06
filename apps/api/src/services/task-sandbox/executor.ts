/**
 * ============================================================
 * Task Executor — 도구 실행 백엔드 추상화 (Cowork 트랙 D0)
 * ============================================================
 *
 * Agent Task 의 "두뇌(루프·판단·승인)"와 "손발(도구 실행·파일 I/O)"을 분리하는
 * 인터페이스. TaskRuntime/tools.ts 는 이 인터페이스에만 의존한다.
 *
 * 구현체:
 *   - TaskSandbox (sandbox.ts)  — 현행 서버 Docker 샌드박스 (D0 에서 랩)
 *   - RemoteExecutor (D1 예정)  — 데스크톱 브리지 경유 사용자 머신 로컬 실행
 *
 * 설계 불변식 (D1 에서도 유지할 것):
 *   - 실행기는 이 인터페이스의 고정 도구 표면만 노출한다 — 임의 RPC 금지.
 *   - 비밀(토큰·자격증명)은 실행기 프로토콜에 싣지 않는다 (Git/PR 토큰 비주입 원칙과 동일).
 *   - 경로는 workspace 스코프 안에서만 해석한다 (safeRealWorkspacePath 등가 가드 필수).
 *
 * @module services/task-sandbox/executor
 */

/** 도구 실행 결과 — 출력 캡/timeout 메타 포함 (기존 sandbox.ts 에서 이동, 재노출 유지). */
export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    truncated: boolean;
    timedOut: boolean;
    durationMs: number;
}

/**
 * 도구 실행 백엔드 인터페이스.
 *
 * TaskSandbox 의 공개 표면과 1:1 — D0 은 동작 무변경 추출이며,
 * 원격 실행기 특화 요구(디바이스 핸드셰이크 등)는 D1 에서 이 계약 위에 얹는다.
 */
/** 코드 탐색 요청 — grep(정규식 매치) · files(파일별 줄 수). 경로는 workspace 상대. */
export interface CodeNavSpec {
    op: 'grep' | 'files';
    /** 대상 경로(상대, 기본 '.'). */
    path?: string;
    /** grep 전용 — 정규식 소스. */
    pattern?: string;
    /** grep 전용 — 파일 글롭('*.ts' 처럼 '/' 가 없으면 파일명에만 적용). */
    glob?: string;
    ignoreCase?: boolean;
    maxResults?: number;
}

/** 코드 탐색 결과 — 실행기가 캡을 적용한 뒤의 값. */
export interface CodeNavData {
    /** grep — "상대경로:줄번호:내용". */
    matches?: string[];
    /** files — 파일별 줄 수. */
    files?: { path: string; lines: number }[];
    /** 실행기 캡에 걸려 잘렸는지. */
    truncated?: boolean;
}

export interface TaskExecutor {
    readonly taskId: string;

    /** 관측/로그·영속(sandboxContainerId)용 식별 라벨 — docker: 컨테이너명, 원격: 디바이스 라벨. */
    readonly label: string;

    /**
     * 서버(호스트) 파일시스템에 workspace 가 있으면 그 절대경로, 원격 실행기는 null.
     * 호스트측 git 연산(code-diff·clone·PR)과 대용량 첨부 스트리밍 주입이 의존한다 —
     * null 이면 해당 기능은 실행기 위임으로 대체해야 한다(D1).
     */
    readonly localWorkdir: string | null;

    /** browser 도구 활성 여부 (도구 노출 게이트). */
    readonly isBrowserEnabled: boolean;

    /** 브라우저 세션 지속 ON 이면 storageState 상대경로, OFF 면 null. */
    readonly browserStatePath: string | null;

    /** 실행 환경 준비 (docker: 컨테이너 기동 / 원격: 디바이스 세션 확립). 멱등. */
    create(): Promise<void>;

    /**
     * 실행기가 자체적으로 변경분 diff 를 제공하면 구현한다(로컬 브리지의 worktree — 레포의 실제
     * HEAD 가 기준점이라 인위적 baseline 커밋이 필요 없다). 미구현이면 호스트측 workspace git
     * 캡처(code-diff)로 폴백한다. 변경 없음·불가는 null.
     */
    captureDiff?(): Promise<string | null>;

    /** 셸 명령 실행 — bash 도구의 실행 백엔드. */
    exec(command: string): Promise<ExecResult>;

    /** 브라우저 액션 배치 실행 (actions JSON 은 workspace 상대경로에 사전 기록). */
    runBrowser(actionsRelPath: string): Promise<ExecResult>;

    /** workspace 상대경로에 파일 쓰기 — 경로 가드 + 디스크 쿼터 적용. */
    writeFile(relPath: string, content: string | Buffer): Promise<void>;

    /** 호스트 파일을 workspace 로 복사(대용량 첨부 — Buffer 미적재 스트리밍). */
    importFile(relPath: string, srcAbsPath: string): Promise<void>;

    /** workspace 파일 읽기 (utf8). 경로 가드 적용. */
    readFile(relPath: string): Promise<string>;

    /** workspace 디렉토리 목록. 경로 가드 적용. */
    listDir(relPath?: string): Promise<string[]>;

    /** 산출물 회수용 — workspace 전체 파일 상대경로 재귀 나열. */
    listWorkspaceFiles(): Promise<string[]>;

    /** workspace 파일/디렉토리 삭제. 루트 삭제 금지. */
    deleteFile(relPath: string): Promise<void>;

    /**
     * 편집 후 진단 — 실행기가 지원하면 구현한다(로컬 브리지: 디바이스의 tsc/py_compile).
     * 미구현이거나 실패·미지원이면 null 을 돌려 호출측이 조용히 생략한다(fail-open).
     * 도구가 없어 검사하지 못한 경우와 "진단 0건"은 `serverKind` 로 구분한다.
     */
    diagnostics?(relPaths: string[]): Promise<{ text: string; count: number } | null>;

    /**
     * 코드 탐색(grep_code·repo_map)의 네이티브 백엔드 — 실행기가 지원하면 구현한다.
     * 미구현이면 도구가 `exec` 로 셸(rg/grep/find)을 돌린다(docker 샌드박스의 기존 경로).
     *
     * 로컬 브리지가 이걸 구현하는 이유: exec 로 내보내면 읽기 전용 탐색인데도 디바이스의
     * confirmExec(비우회 승인 창)이 매번 뜬다. 전용 kind 는 셸을 거치지 않아 승인 없이 돈다.
     * 실패·구 디바이스(kind 미지원)는 **null** 을 돌려 호출측이 셸 경로로 폴백한다(fail-open).
     */
    codeNav?(spec: CodeNavSpec): Promise<CodeNavData | null>;

    /** 실행 환경 정리. removeWorkspace=false 면 산출물 회수를 위해 workspace 보존. 멱등. */
    cleanup(removeWorkspace?: boolean): Promise<void>;
}
