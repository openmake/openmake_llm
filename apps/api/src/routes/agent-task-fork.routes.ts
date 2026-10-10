/**
 * 체크포인트 이력·분기(fork) 라우트 (F08 PR-7, 141) — agent-task.routes.ts 에서 router.use 로 마운트.
 *   GET  /api/agent-tasks/:taskId/checkpoints          — 이력 목록(턴·메시지 수·시각)
 *   POST /api/agent-tasks/:taskId/fork { fromTurn, goal? } — 그 턴의 체크포인트로 새 pending 작업 생성(클라이언트가 이어서 /resume)
 * 상태 전이표 변경 없음(pending → running 은 표에 있음). 워크스페이스 복원은 services/agent-task/fork-workspace(기본 꺼짐)가
 * 재개 때 시도한다 — 여기서는 대화 끝에 안내를 붙이고 입력 첨부·승인 정책(183)을 복사한다. 로컬 실행 작업은 같은 디바이스·폴더로만 fork.
 * @module routes/agent-task-fork
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getUnifiedDatabase, getPool } from '../data/models/unified-database';
import { AgentTaskRepository } from '../data/repositories/agent-task-repository';
import { AgentTaskParkRepository } from '../data/repositories/agent-task-park-repository';
import { loadOwnedTask } from './agent-task.helpers';
import { buildForkNotice } from '../prompts/agent-task-prompt';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { findDanglingToolCalls } from '../services/agent-task/turn-reentry';
import { cleanConversationForFork } from '../services/agent-task/one-shot-notice';
import { AGENT_TASK_SCHEDULE } from '../config/agent-task-schedule';
import type { ChatMessage } from '../llm/types';

const logger = createLogger('AgentTaskForkRoutes');
export const forkRouter = Router();

forkRouter.get('/:taskId/checkpoints', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    res.json(success({ checkpoints: await new AgentTaskRepository(getPool()).listCheckpoints(task.id) }));
}));

forkRouter.post('/:taskId/fork', asyncHandler(async (req: Request, res: Response) => {
    const src = await loadOwnedTask(req, res, req.params.taskId);
    if (!src) return;
    const body = (req.body ?? {}) as { fromTurn?: unknown; goal?: unknown };
    const fromTurn = Number(body.fromTurn);
    // 체크포인트 턴은 0 기준 완료 턴 번호다(첫 턴 도중의 턴 중간 체크포인트는 -1) — turn-reentry.writeTurnCheckpoint 와 짝.
    if (!Number.isInteger(fromTurn) || fromTurn < -1) return res.status(400).json(badRequest('fromTurn 은 -1 이상의 정수여야 합니다.'));
    const repo = new AgentTaskRepository(getPool());
    const cp = await repo.getCheckpoint(src.id, fromTurn);
    if (!cp) return res.status(404).json(notFound(`턴 ${fromTurn} 의 체크포인트가 없습니다(이력은 최근 것만 보존).`));
    const goal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : src.goal;
    // 턴 중간 체크포인트는 결과 없는 tool_call 이 매달려 있다 — 그 assistant 부터 잘라 새 워크스페이스에서 그 턴을 다시 수행한다.
    // 안내는 user 역할로 붙인다(대화 중간 system 메시지는 vLLM 이 400 으로 거절한다 — 계획 편집·steering 과 같은 방식).
    // 일회성 안내(검색 한도·마무리 턴 등)는 원 실행의 자원 상태라 뺀다 — 새 작업은 횟수·예산이 다시 시작한다. 모델 응답에 대한
    // 되묻기도 그 응답과 짝으로 뺀다. 자르기 전에 정리해야 호출과 결과 사이에 낀 안내(stuck)가 매달린 호출을 가리지 않는다.
    const base = cleanConversationForFork(cp.conversation as ChatMessage[], { stripReplies: AGENT_TASK_SCHEDULE.FORK_STRIP_REPLY_NUDGES_ENABLED });
    const cut = findDanglingToolCalls(base) ? base.map((m) => m.role).lastIndexOf('assistant') : base.length;
    const notice = buildForkNotice({
        restoreEnabled: AGENT_TASK_LIMITS.FORK_WORKSPACE_RESTORE_ENABLED, newGoal: goal !== src.goal ? goal : undefined,
    });
    const conversation = [...base.slice(0, cut), { role: 'user', content: notice }];

    const db = getUnifiedDatabase();
    const id = uuidv4();
    await db.createAgentTask({
        id, userId: String(req.user!.id), goal, maxTurns: src.max_turns,
        inputFiles: src.input_files ?? undefined, inputImages: src.input_images ?? undefined,
        executor: src.executor === 'local' ? 'local' : undefined, deviceId: src.device_id ?? undefined, folderRel: src.folder_rel ?? undefined,
    });
    await db.updateAgentTask(id, { checkpoint: { conversation, completedTurn: fromTurn }, ...(cp.plan ? { plan: cp.plan } : {}) });
    await repo.markForked(id, src.id, fromTurn).catch(() => { /* 표시용 — 실패해도 fork 는 유효 */ });
    // 원 작업의 승인 정책을 물려준다 — 분기 재개(/resume, 본문 없음)는 저장된 정책을 읽으므로(approval-policy-restore) 이게 없으면
    // 'high-risk' 로 돌던 작업이 분기 뒤 'all'(매 도구 승인)로 바뀐다(2026-10-08 라이브 확인). 실패해도 더 보수적인 쪽으로만 틀어진다.
    if (src.approval_policy) {
        await new AgentTaskParkRepository(getPool()).setApprovalPolicy(id, src.approval_policy)
            .catch((e) => logger.warn(`[AgentTaskForkRoutes] 승인 정책 물려주기 실패 (무시): ${e instanceof Error ? e.message : String(e)}`));
    }
    // 추론 수준(184)도 같은 이유로 물려준다 — 분기 재개는 저장값을 읽는다(thinking-level-restore).
    if (src.thinking_level) {
        await new AgentTaskParkRepository(getPool()).setThinkingLevel(id, src.thinking_level)
            .catch((e) => logger.warn(`[AgentTaskForkRoutes] 추론 수준 물려주기 실패 (무시): ${e instanceof Error ? e.message : String(e)}`));
    }
    logger.info(`[AgentTaskForkRoutes] fork: ${src.id}@${fromTurn} → ${id} (user ${req.user!.id})`);
    res.status(201).json(success({ taskId: id, fromTaskId: src.id, fromTurn, next: `/api/agent-tasks/${id}/resume` }));
}));
