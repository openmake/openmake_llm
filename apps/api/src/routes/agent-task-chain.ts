/**
 * 체인(188) 조회 보조 — 응답의 chain 블록. 사용량은 마지막 세그먼트의 continuation 누적 + 그 세그먼트 자체 토큰.
 * usedMs 는 진행 중 세그먼트의 활성 시간을 더하지 않는다 — 세그먼트가 끝나야 누적된다(표시용, 예산 판정은 런타임이 한다).
 * agent-task.routes.ts 가 600줄 상한이라 상세 응답 조립(detailPayload)·?chain= 목록(chainTaskList)도 여기 둔다.
 * @module routes/agent-task-chain
 */
import type { Request } from 'express';
import type { AgentTask, AgentTaskStep } from '../data/models/unified-database.types';
import { getUnifiedDatabase, getPool } from '../data/models/unified-database';
import { AgentTaskChainRepository } from '../data/repositories/agent-task-chain-repository';
import { AppError, AuthorizationError } from '../utils/error-handler';
import { isAdminRole } from '../data/user-manager';
import { toPublicTask, waitReasonOf } from './agent-task.helpers';

export type ChainRow = Pick<AgentTask, 'id' | 'status' | 'total_tokens' | 'completion_path' | 'continuation' | 'continued_by_task_id' | 'created_at'>;

export interface ChainInfo {
    rootId: string;
    segmentIndex: number;
    segmentCount: number;
    continuedFrom: string | null;
    continuedBy: string | null;
    /** 끝나지 않은 세그먼트(없으면 null — 체인이 끝남) */
    activeSegmentId: string | null;
    budget: { usedMs: number; usedTokens: number; segments: number; maxMs: number; maxTokens: number; maxSegments: number };
    cancelled: boolean;
}

export function buildChainInfo(task: AgentTask, root: AgentTask | null, segments: ChainRow[]): ChainInfo | undefined {
    if (!task.chain_root_task_id || !root?.long_running) return undefined;
    const last = segments[segments.length - 1];
    const active = segments.find((s) => s.status !== 'completed' && s.status !== 'failed' && s.status !== 'cancelled');
    return {
        rootId: root.id,
        segmentIndex: task.continuation?.segmentIndex ?? 0,
        segmentCount: segments.length,
        continuedFrom: task.continued_from_task_id ?? null,
        continuedBy: task.continued_by_task_id ?? null,
        activeSegmentId: active?.id ?? null,
        budget: {
            usedMs: last?.continuation?.chainUsedMs ?? 0,
            usedTokens: (last?.continuation?.chainUsedTokens ?? 0) + Number(last?.total_tokens ?? 0),
            segments: segments.length,
            maxMs: root.long_running.maxDurationMs, maxTokens: root.long_running.maxTotalTokens, maxSegments: root.long_running.maxSegments,
        },
        cancelled: !!root.long_running.cancelled,
    };
}

/** 상세 응답의 chain 블록 — 체인이 아니면 빈 객체(DB 호출 없음). */
export async function chainInfoOf(task: AgentTask): Promise<{ chain?: ChainInfo }> {
    if (!task.chain_root_task_id) return {};
    const repo = new AgentTaskChainRepository(getPool());
    const root = task.chain_root_task_id === task.id ? task : await getUnifiedDatabase().getAgentTask(task.chain_root_task_id);
    const chain = buildChainInfo(task, root ?? null, await repo.listChain(task.chain_root_task_id));
    return chain ? { chain } : {};
}

/** 취소 라우트 보조 — 체인이면 루트에 취소 표식. 표식 실패는 다음 세그먼트의 status 검사가 막으므로 삼킨다. */
export async function cancelChainIfAny(task: AgentTask): Promise<void> {
    if (!task.chain_root_task_id) return;
    await new AgentTaskChainRepository(getPool()).markChainCancelled(task.chain_root_task_id).catch(() => { /* 위 설명 */ });
}

const isFinished = (status: string): boolean => status === 'completed' || status === 'failed' || status === 'cancelled';

/**
 * PURE: 취소 대상 — 체인 세그먼트(루트·앞 세그먼트)로 취소를 요청하면 그 행은 이미 '이어짐'(completed)이라
 * 실제로 돌고 있는 끝나지 않은 세그먼트를 취소해야 한다(설계 §2.4). 요청 작업이 아직 끝나지 않았거나
 * 체인이 아니거나 끝나지 않은 세그먼트가 없으면 요청 작업 그대로.
 */
export function resolveCancelTarget(task: Pick<AgentTask, 'id' | 'status' | 'chain_root_task_id'>, segments: Array<Pick<ChainRow, 'id' | 'status'>>): string {
    if (!task.chain_root_task_id || !isFinished(task.status)) return task.id;
    return segments.find((s) => !isFinished(s.status))?.id ?? task.id;
}

/** 취소 라우트 보조 — 실제로 취소할 작업 행(체인이면 끝나지 않은 세그먼트, 같은 소유자일 때만). 아니면 요청 작업. */
export async function cancelTargetOf(task: AgentTask): Promise<AgentTask> {
    if (!task.chain_root_task_id || !isFinished(task.status)) return task;
    const segments = await new AgentTaskChainRepository(getPool()).listChain(task.chain_root_task_id);
    const id = resolveCancelTarget(task, segments);
    if (id === task.id) return task;
    const target = await getUnifiedDatabase().getAgentTask(id);
    return target && String(target.user_id) === String(task.user_id) ? target : task;
}

/** GET /:taskId 응답 본문 — 공개 task(+대기 사유·chain 블록)와 스텝. */
export async function detailPayload(task: AgentTask, steps: AgentTaskStep[]) {
    return { task: { ...toPublicTask(task as unknown as Record<string, unknown>), ...(await waitReasonOf(task)), ...(await chainInfoOf(task)) }, steps };
}

/** GET /?chain=<rootId> — 체인 세그먼트 목록. 권한은 기존 목록과 같다: 루트가 내 것이거나 admin. */
export async function chainTaskList(req: Request): Promise<ChainRow[]> {
    const root = await getUnifiedDatabase().getAgentTask(String(req.query.chain));
    if (!root) throw new AppError('체인을 찾을 수 없습니다', 404, true, 'NOT_FOUND');
    if (String(root.user_id) !== String(req.user!.id) && !isAdminRole(req.user!.role)) throw new AuthorizationError('이 체인을 볼 권한이 없습니다');
    return new AgentTaskChainRepository(getPool()).listChain(root.id);
}
