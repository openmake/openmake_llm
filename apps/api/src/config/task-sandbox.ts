/**
 * Task 샌드박스 설정 (Manus화 Phase 1 / C1) — No-Hardcoding L1/L2 외부화.
 *
 * 영속 task 샌드박스(services/task-sandbox)가 참조하는 모든 상수. 전부 env 오버라이드.
 * ⚠️ TASK_SANDBOX_ENABLED 기본 OFF — 운영 활성화는 사용자 직접(요청경로 미연결 상태로 머지).
 *
 * @module config/task-sandbox
 */

/** 컨테이너 네트워크 정책. C1 은 none 출발, restricted(allowlist) fast-follow. full 미허용. */
export type TaskSandboxNetwork = 'none' | 'restricted';

/**
 * 도구 호출 승인 정책 (HITL 게이트).
 * - all: 모든 도구 호출에 사용자 승인 필요 (가장 안전, 기본값).
 * - high-risk: 고위험 도구(bash·file 삭제·network egress)만 승인.
 * - none: 승인 없이 자동 실행 (빠름, 위험↑).
 */
export type TaskSandboxApprovalPolicy = 'all' | 'high-risk' | 'none';

/** 입력 첨부 파일이 기록되는 workspace 하위 디렉토리 (에이전트 안내 프롬프트와 공유되는 경로 계약). */
export const TASK_UPLOAD_DIR = 'uploads';

function intEnv(raw: string | undefined, def: number): number {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

export interface TaskSandboxConfig {
    /** 마스터 게이트 (기본 OFF). */
    enabled: boolean;
    /** docker 바이너리 경로(또는 'docker'). */
    dockerPath: string;
    /** task 런타임 이미지 (infra/task-runtime). */
    image: string;
    /** 호스트 workspace 루트 — task별 하위 디렉토리 생성. */
    workspaceRoot: string;
    /** 동시 활성 컨테이너 상한. */
    maxConcurrent: number;
    /** 네트워크 정책. */
    network: TaskSandboxNetwork;
    /** restricted 시 egress 허용 도메인(쉼표구분). */
    networkAllowlist: string[];
    /** 컨테이너 메모리 상한(docker --memory 표기). */
    memory: string;
    /** CPU 상한(docker --cpus). */
    cpus: string;
    /** pids 상한. */
    pidsLimit: number;
    /** 컨테이너 유저(uid:gid). */
    user: string;
    /** 단일 명령(exec) timeout(ms). */
    execTimeoutMs: number;
    /** exec stdout/stderr 캡처 상한(byte). */
    outputCap: number;
    /** workspace 디스크 쿼터(byte) — 초과 시 정리/거절. */
    workspaceQuota: number;
    /** 도구 호출 승인 정책 (기본 all — 전부 승인). */
    approvalPolicy: TaskSandboxApprovalPolicy;
    /** 로컬 브리지 실행 시 true — 코드 실행(bash/python_execute)을 디바이스가 자체 확인하므로
     *  서버측 승인을 skip 해 이중 프롬프트를 없앤다(executor-select 에서 주입). */
    deviceGatesShell?: boolean;
    /** 승인 대기 timeout(ms) — 초과 시 자동 거절(작업 일시정지 해제). */
    approvalTimeoutMs: number;
    /** 완료 task workspace 보존 TTL(ms) — 초과한 workspace 디렉토리는 정리 스윕이 삭제. */
    workspaceTtlMs: number;
    /**
     * 브라우저 도구 활성 여부(기본 true). 메인 샌드박스는 항상 TASK_SANDBOX_NETWORK(기본 none)이고,
     * browser 만 별도 일회성 컨테이너(browserNetwork)에서 실행 — bash/python 은 인터넷 미접근.
     */
    browserEnabled: boolean;
    /**
     * 브라우저 세션 지속(#2 Part A, 기본 false). ON 시 브라우저 호출 간 storageState(쿠키·localStorage)를
     * workspace 파일(.browser-state.json)에 저장/복원 → 로그인 유지. 일회성 컨테이너 모델은 무변경
     * (컨테이너는 계속 --rm, 상태만 workspace 에 영속). 파일은 task 격리·정리와 동일 수명.
     */
    browserPersist: boolean;
    /** 브라우저 전용 일회성 컨테이너의 네트워크(기본 bridge — 브라우저는 인터넷 필요). egress 프록시 ON 시 무시. */
    browserNetwork: string;
    /**
     * 브라우저 egress 프록시(네트워크 레벨 도메인 allowlist) 활성 여부(기본 false).
     * ON 시 브라우저 컨테이너는 internal 망(인터넷 차단)에만 연결되고 프록시 통해서만 allowlist 도메인에 도달.
     * 외부 출시 전 권장. bash/python 은 network=none 이라 무관.
     */
    egressProxyEnabled: boolean;
    /** egress 프록시 허용 도메인(쉼표/배열). 비면 전부 거부(fail-safe). */
    egressAllowlist: string[];
    /** egress 프록시 이미지(infra/egress-proxy). */
    egressProxyImage: string;
    /** internal Docker 네트워크 이름(브라우저 컨테이너 인터넷 차단망). */
    egressNetwork: string;
    /** egress 프록시 컨테이너 이름. */
    egressProxyContainer: string;
    /** egress 프록시 포트. */
    egressProxyPort: number;
    /**
     * 코드 작업 diff 캡처(openmake_code v1) 활성 여부(기본 true — 샌드박스 ON 일 때만 유효).
     * ON: 실행 시작 시 workspace 를 git baseline 으로 스냅샷하고, 완료 시 에이전트 변경분을
     * `git diff` 로 캡처해 step_type='diff' 스텝으로 영속화한다(빈 diff 는 미기록). fail-open.
     */
    codeDiffEnabled: boolean;
    /**
     * 샌드박스 활성 시 샌드박스 도구와 함께 LLM 에 노출할 비-샌드박스(내장 MCP) 도구 화이트리스트(이름).
     * 전체 MCP 카탈로그(~150 도구)는 vLLM 문법 컴파일 폭주를 유발하므로 제외하되,
     * 샌드박스로 대체 불가한 소수 고가치 도구(예: web_search)만 선별 노출.
     * 비면 샌드박스 도구만 노출(순수 Manus). 기본 web_search. (이미지·음성·영상 생성은 2026-09-12 부터 채팅 오케스트레이터 전용 — 작업 도구 없음)
     * ⚠️ 이 도구들은 격리 컨테이너가 아닌 호스트(API 프로세스)에서 실행된다 — HITL 승인
     * 게이트는 task 도구와 동일하게 적용되지만(AgentTaskService 디스패치), 그래도
     * FS/셸 변경이 없는 조회류(web_search 등)만 등록할 것. 위험 도구 금지.
     */
    extraTools: string[];
    /**
     * workspace 파일 쓰기를 호스트가 아니라 컨테이너 안에서(`docker exec`) 한다.
     * macOS 의 Colima(virtiofs)는 컨테이너가 방금 본 파일을 호스트가 덮어쓰면 약 1초 동안 예전 크기로 읽는다 —
     * 컨테이너 안에서 쓰면 컨테이너도 호스트도 곧바로 정확히 읽는다. 기본: 전용 Colima 를 쓰는 호스트에서만 켠다.
     */
    writeViaContainer?: boolean;
}

/** PURE: writeViaContainer 기본값 — TASK_SANDBOX_WRITE_VIA_CONTAINER 가 있으면 그 값, 없으면 docker 접속처가 Colima 인지. */
export function resolveWriteViaContainer(env: Record<string, string | undefined>): boolean {
    const v = env.TASK_SANDBOX_WRITE_VIA_CONTAINER;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return /^unix:\/\/.*\/\.colima\//.test(env.DOCKER_HOST ?? '');
}

export function getTaskSandboxConfig(): TaskSandboxConfig {
    const net = process.env.TASK_SANDBOX_NETWORK === 'restricted' ? 'restricted' : 'none';
    const policyRaw = process.env.TASK_SANDBOX_APPROVAL_POLICY;
    const approvalPolicy: TaskSandboxApprovalPolicy =
        policyRaw === 'none' || policyRaw === 'high-risk' ? policyRaw : 'all';
    return {
        enabled: process.env.TASK_SANDBOX_ENABLED === 'true',
        dockerPath: process.env.TASK_SANDBOX_DOCKER_PATH || 'docker',
        image: process.env.TASK_SANDBOX_IMAGE || 'openmake-task-runtime:latest',
        workspaceRoot: process.env.TASK_SANDBOX_ROOT || '/tmp/openmake-task-workspaces',
        maxConcurrent: intEnv(process.env.TASK_SANDBOX_MAX_CONCURRENT, 8),
        network: net,
        networkAllowlist: (process.env.TASK_SANDBOX_NETWORK_ALLOWLIST || '')
            .split(',').map((s) => s.trim()).filter(Boolean),
        memory: process.env.TASK_SANDBOX_MEMORY || '1g',
        cpus: process.env.TASK_SANDBOX_CPUS || '1.0',
        pidsLimit: intEnv(process.env.TASK_SANDBOX_PIDS_LIMIT, 512),
        user: process.env.TASK_SANDBOX_USER || '1000:1000',
        execTimeoutMs: intEnv(process.env.TASK_SANDBOX_EXEC_TIMEOUT_MS, 120_000),
        outputCap: intEnv(process.env.TASK_SANDBOX_OUTPUT_CAP, 256 * 1024),
        workspaceQuota: intEnv(process.env.TASK_SANDBOX_WORKSPACE_QUOTA, 512 * 1024 * 1024),
        approvalPolicy,
        approvalTimeoutMs: intEnv(process.env.TASK_SANDBOX_APPROVAL_TIMEOUT_MS, 30 * 60_000),
        workspaceTtlMs: intEnv(process.env.TASK_SANDBOX_WORKSPACE_TTL_MS, 24 * 60 * 60_000),
        browserEnabled: process.env.TASK_SANDBOX_BROWSER_ENABLED !== 'false',
        browserPersist: process.env.TASK_SANDBOX_BROWSER_PERSIST === 'true',
        browserNetwork: process.env.TASK_SANDBOX_BROWSER_NETWORK || 'bridge',
        egressProxyEnabled: process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED === 'true',
        egressAllowlist: (process.env.TASK_SANDBOX_EGRESS_ALLOWLIST || '')
            .split(',').map((s) => s.trim()).filter(Boolean),
        egressProxyImage: process.env.TASK_SANDBOX_EGRESS_PROXY_IMAGE || 'openmake-egress-proxy:latest',
        egressNetwork: process.env.TASK_SANDBOX_EGRESS_NETWORK || 'omk-egress-internal',
        egressProxyContainer: process.env.TASK_SANDBOX_EGRESS_PROXY_CONTAINER || 'omk-egress-proxy',
        egressProxyPort: intEnv(process.env.TASK_SANDBOX_EGRESS_PROXY_PORT, 8888),
        codeDiffEnabled: process.env.TASK_SANDBOX_CODE_DIFF_ENABLED !== 'false',
        writeViaContainer: resolveWriteViaContainer(process.env),
        extraTools: (process.env.TASK_SANDBOX_EXTRA_TOOLS ?? 'web_search')
            .split(',').map((s) => s.trim()).filter(Boolean),
    };
}

/** 승인 미리보기 diff(F18 PR-2, 138) 크기 캡. 기본 켜짐(APPROVAL_PREVIEW_ENABLED=false 로 끔). */
export const APPROVAL_PREVIEW = {
    ENABLED: process.env.APPROVAL_PREVIEW_ENABLED !== 'false',
    /** 파일 내용 상한(chars) — 넘으면 미리보기 생략 */
    FILE_MAX_CHARS: parseInt(process.env.APPROVAL_PREVIEW_FILE_MAX_CHARS || '65536', 10),
    /** diff 상한(chars) — 넘으면 절단 표시 */
    DIFF_MAX_CHARS: parseInt(process.env.APPROVAL_PREVIEW_DIFF_MAX_CHARS || '32768', 10),
} as const;

/**
 * 브라우저 넘겨받기(Take control) — 사용자가 에이전트의 브라우저 세션을 직접 조작한다.
 * 세션은 작업별 컨테이너 하나이고, 명령은 `docker exec` 로만 전달한다(호스트로 포트를 열지 않는다).
 */
export const BROWSER_SESSION = {
    /** 입력이 없으면 세션을 내리는 시간(ms) — 로그인 상태를 저장한 뒤 종료한다. */
    IDLE_MS: intEnv(process.env.TASK_SANDBOX_BROWSER_SESSION_IDLE_MS, 10 * 60_000),
    /** 컨테이너 안 루프백 포트 */
    PORT: 9333,
    /** 화면 크기 — 클릭 좌표 검증과 스크린샷의 기준 */
    VIEWPORT: { width: 1280, height: 800 },
    /** 스크린샷 JPEG 품질 */
    JPEG_QUALITY: 60,
    /** 한 번에 보낼 수 있는 글자 수 */
    TEXT_MAX: 2000,
    /** 한 번에 스크롤할 수 있는 거리(px) */
    SCROLL_MAX: 5000,
    /** 에이전트 browser 도구와 함께 쓰는 로그인 상태 파일(workspace 상대경로) */
    STATE_FILE: '.browser-state.json',
    /** workspace 에 써 두고 실행하는 세션 스크립트(이미지 재빌드 없이 배포) */
    SCRIPT_FILE: '.omk-browser-session.mjs',
    /** 세션이 뜰 때까지 기다리는 시간(ms) */
    READY_TIMEOUT_MS: 30_000,
    /** 명령 하나의 상한(ms) */
    COMMAND_TIMEOUT_MS: 30_000,
    /** 명령 응답 크기 상한(byte) — 스크린샷(base64)이 실린다 */
    OUTPUT_CAP: 4 * 1024 * 1024,
} as const;

/**
 * 브라우저 도구 목적지 검사 — goto 주소가 사설망·루프백·메타데이터로 해석되면 실행하지 않는다
 * (services/task-sandbox/browser-url-guard, 호스트 쪽 SSRF 가드와 같은 기준·같은 허용 예외).
 * TASK_SANDBOX_BROWSER_URL_GUARD=false 로 끈다.
 */
export const BROWSER_URL_GUARD_ENABLED = process.env.TASK_SANDBOX_BROWSER_URL_GUARD !== 'false';
