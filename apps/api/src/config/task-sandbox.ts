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
}

export function getTaskSandboxConfig(): TaskSandboxConfig {
    const net = process.env.TASK_SANDBOX_NETWORK === 'restricted' ? 'restricted' : 'none';
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
    };
}
