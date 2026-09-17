/**
 * 에이전트 작업 실행 종료 정리 — AgentTaskService.execute 의 finally 에서 분리(파일 크기 가드).
 *
 * - 승인: 자동승인 해제 + 저장소의 남은 pending 만료. 주차(F16.7)는 질문 승인을 **남긴다**(답이 오면 재개 근거).
 * - steering: 미소비 지시 정리(다음 동명 실행으로 새지 않게).
 * - 샌드박스: 완료·주차는 workspace 보존(다운로드·재개), 그 외는 삭제 직전 코드 diff 캡처 후 삭제.
 *
 * @module services/agent-task/run-cleanup
 */
import { getApprovalRegistry } from '../task-sandbox/approval-gate';
import { getSteeringRegistry } from './steering';
import { captureDiffOnCleanup } from './code-diff';
import { createLogger } from '../../utils/logger';
import type { TaskRuntime } from '../task-sandbox/runtime';

const logger = createLogger('AgentTaskRunCleanup');

export async function cleanupTaskRun(opts: {
    taskId: string;
    taskRuntime: TaskRuntime | null;
    /** 종료 시점의 상태(curStatus) */
    status: string;
    /** 질문 응답 대기로 주차됐는가 */
    parked: boolean;
    stepNumber: number;
}): Promise<void> {
    const { taskId, taskRuntime, parked, stepNumber } = opts;
    if (parked) getApprovalRegistry().clearAutoApprove(taskId);
    else getApprovalRegistry().closeTask(taskId);
    getSteeringRegistry().clear(taskId);
    if (!taskRuntime) return;
    const keepWorkspace = opts.status === 'completed' || parked;
    if (!keepWorkspace) await captureDiffOnCleanup(taskRuntime, taskId, stepNumber).catch(() => { /* fail-open */ });
    await taskRuntime.cleanup(!keepWorkspace).catch((e) => logger.warn(`[AgentTask] 샌드박스 정리 실패: ${taskId} — ${e}`));
}
