/**
 * 실행 백엔드/승인 정책 결정 (Cowork D1a) — AgentTaskService 에서 분리(파일 크기 가드).
 *
 * - executor='local' + 게이트 ON → RemoteExecutor(로컬 브리지). 승인 정책은 호출자가 명시한
 *   input.approvalPolicy 를 그대로 쓰고, **미지정일 때만 'all'** 로 둔다(전역 기본값보다 보수적 —
 *   docker 격리가 없으므로). 과거엔 명시값도 'all' 로 덮어써 웹 컴포저의 "건너뜀/자동" 이 로컬
 *   실행에서 조용히 무시됐다(2026-09-05 라이브 관찰). CLI 는 이미 `--yes` 로 서버 승인을 전부
 *   건너뛰므로 웹만 막는 것은 비대칭이었다. 코드 실행은 정책과 무관하게 디바이스 confirmExec 가 게이트.
 * - 그 외 → 현행 docker 샌드박스, input.approvalPolicy 는 이 실행에 한해 override.
 * - 게이트 OFF 면 sandbox 로 폴백(생성 시점에 이미 검증되나 방어).
 *
 * @module services/agent-task/executor-select
 */
import { getTaskSandboxConfig, type TaskSandboxConfig } from '../../config/task-sandbox';
import { LOCAL_BRIDGE } from '../../config/local-bridge';
import { RemoteExecutor } from '../local-bridge/remote-executor';
import type { AgentTaskRunInput } from './types';

export interface ExecutorPlan {
    sandboxCfg: TaskSandboxConfig;
    /** TaskRuntime 조립 여부 — docker 샌드박스 ON 이거나 로컬 실행기일 때. */
    runtimeEnabled: boolean;
    /** local 이면 TaskRuntime 에 주입할 실행기, 아니면 undefined(기본 docker). */
    remoteExecutor?: RemoteExecutor;
}

export function resolveExecutorPlan(
    input: Pick<AgentTaskRunInput, 'executor' | 'approvalPolicy' | 'deviceId' | 'folderRel'>,
    taskId: string,
    userId: string,
): ExecutorPlan {
    const isLocal = input.executor === 'local' && LOCAL_BRIDGE.ENABLED;
    // 로컬: 파일/기타 도구는 서버 승인 유지(디바이스는 파일에 다이얼로그 없음)하되, 코드 실행
    // (bash/python_execute)은 디바이스 confirmExec 가 게이트하므로 deviceGatesShell 로 서버 승인 skip.
    const sandboxCfg = isLocal
        ? { ...getTaskSandboxConfig(), approvalPolicy: input.approvalPolicy ?? ('all' as const), deviceGatesShell: true }
        : input.approvalPolicy
            ? { ...getTaskSandboxConfig(), approvalPolicy: input.approvalPolicy }
            : getTaskSandboxConfig();
    return {
        sandboxCfg,
        runtimeEnabled: sandboxCfg.enabled || isLocal,
        remoteExecutor: isLocal ? new RemoteExecutor(taskId, userId, input.deviceId, input.folderRel) : undefined,
    };
}
