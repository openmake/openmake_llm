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
    /** 승인 대기 timeout(ms) — 초과 시 자동 거절(작업 일시정지 해제). */
    approvalTimeoutMs: number;
    /** 완료 task workspace 보존 TTL(ms) — 초과한 workspace 디렉토리는 정리 스윕이 삭제. */
    workspaceTtlMs: number;
    /**
     * 브라우저 도구 활성 여부(기본 true). 메인 샌드박스는 항상 TASK_SANDBOX_NETWORK(기본 none)이고,
     * browser 만 별도 일회성 컨테이너(browserNetwork)에서 실행 — bash/python 은 인터넷 미접근.
     */
    browserEnabled: boolean;
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
        browserNetwork: process.env.TASK_SANDBOX_BROWSER_NETWORK || 'bridge',
        egressProxyEnabled: process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED === 'true',
        egressAllowlist: (process.env.TASK_SANDBOX_EGRESS_ALLOWLIST || '')
            .split(',').map((s) => s.trim()).filter(Boolean),
        egressProxyImage: process.env.TASK_SANDBOX_EGRESS_PROXY_IMAGE || 'openmake-egress-proxy:latest',
        egressNetwork: process.env.TASK_SANDBOX_EGRESS_NETWORK || 'omk-egress-internal',
        egressProxyContainer: process.env.TASK_SANDBOX_EGRESS_PROXY_CONTAINER || 'omk-egress-proxy',
        egressProxyPort: intEnv(process.env.TASK_SANDBOX_EGRESS_PROXY_PORT, 8888),
    };
}
