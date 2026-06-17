/**
 * ============================================================
 * Agent Task Routes - 자율 에이전트 작업 관리 API 라우트
 * ============================================================
 *
 * 백그라운드 자율 도구 에이전트의 작업 생성, 비동기 실행, 진행상황/결과 조회,
 * 취소를 담당합니다. 실행은 WebSocket/HTTP 연결과 분리된 detached 백그라운드라
 * 연결이 끊겨도 계속 진행되며, taskId 로 진행상황을 다시 조회(복구)할 수 있습니다.
 *
 * @module routes/agent-task.routes
 * @description
 * - POST   /api/agent-tasks                 - 작업 생성 (인증)
 * - GET    /api/agent-tasks                 - 작업 목록 조회
 * - GET    /api/agent-tasks/:taskId         - 작업 상세 조회 (스텝 포함)
 * - GET    /api/agent-tasks/:taskId/steps   - 스텝(체크포인트) 목록 조회
 * - POST   /api/agent-tasks/:taskId/execute - 비동기 실행 (HTTP 202, detached)
 * - POST   /api/agent-tasks/:taskId/cancel  - 실행 중 작업 취소
 * - DELETE /api/agent-tasks/:taskId         - 작업 삭제
 */
import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { validate } from '../middlewares/validation';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { v4 as uuidv4 } from 'uuid';
import { AgentTaskService } from '../services/AgentTaskService';
import type { ChatMessage } from '../llm/types';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { createAgentTaskSchema } from '../schemas/agent-task.schema';

const logger = createLogger('AgentTaskRoutes');
const router = Router();

// 모든 엔드포인트 인증 필요
router.use(requireAuth);

type UserTier = 'free' | 'pro' | 'enterprise';
type UserRole = 'admin' | 'user' | 'guest';

/** 소유권 검증 후 작업 반환 — 없거나 권한 없으면 응답 종료하고 undefined 반환 */
async function loadOwnedTask(req: Request, res: Response, taskId: string) {
    const db = getUnifiedDatabase();
    const task = await db.getAgentTask(taskId);
    if (!task) {
        res.status(404).json(notFound('작업을 찾을 수 없습니다.'));
        return undefined;
    }
    assertResourceOwnerOrAdmin(String(task.user_id), String(req.user!.id), req.user!.role || 'user');
    return task;
}

/** 응답용 변환: 큰 checkpoint 필드 제거 + resumable 플래그(중단된 작업에 체크포인트 존재) */
function toPublicTask(t: Record<string, unknown>) {
    const { checkpoint, ...rest } = t;
    return { ...rest, resumable: !!checkpoint && t.status === 'failed' };
}

/**
 * POST /api/agent-tasks
 * 작업 생성
 */
router.post('/', validate(createAgentTaskSchema), asyncHandler(async (req: Request, res: Response) => {
    const { goal, maxTurns } = req.body;

    const taskId = uuidv4();
    const db = getUnifiedDatabase();
    const userId = String(req.user!.id);

    // 비동기 에이전트 중복 인지(P-6): 이미 진행 중인 작업이 있으면 경고를 함께 반환 —
    // 동일/유사 작업을 중복 실행하기 전에 사용자가 인지하도록(중단/취소 판단). 생성 자체는 막지 않음.
    const existing = await db.getUserAgentTasks(userId);
    const active = existing.filter(t => t.status === 'running' || t.status === 'pending');
    const warnings = active.length > 0
        ? [`진행 중인 에이전트 작업이 ${active.length}건 있습니다. 중복 실행이 아닌지 확인하세요.`]
        : [];

    await db.createAgentTask({
        id: taskId,
        userId,
        goal,
        maxTurns: maxTurns ?? AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS,
    });

    const task = await db.getAgentTask(taskId);
    res.status(201).json(success({ task, concurrentActive: active.length, warnings }));
}));

/**
 * GET /api/agent-tasks
 * 사용자의 작업 목록
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const db = getUnifiedDatabase();
    const tasks = await db.getUserAgentTasks(String(req.user!.id));
    res.json(success({ tasks: tasks.map(t => toPublicTask(t as unknown as Record<string, unknown>)), total: tasks.length }));
}));

/**
 * GET /api/agent-tasks/:taskId
 * 작업 상세 (스텝 포함)
 */
router.get('/:taskId', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const db = getUnifiedDatabase();
    const steps = await db.getAgentTaskSteps(req.params.taskId);
    res.json(success({ task: toPublicTask(task as unknown as Record<string, unknown>), steps }));
}));

/**
 * GET /api/agent-tasks/:taskId/steps
 * 스텝(체크포인트) 목록
 */
router.get('/:taskId/steps', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const db = getUnifiedDatabase();
    const steps = await db.getAgentTaskSteps(req.params.taskId);
    res.json(success({ steps, total: steps.length }));
}));

/**
 * POST /api/agent-tasks/:taskId/execute
 * 비동기 실행 (HTTP 202) — detached 백그라운드. 연결과 무관하게 진행.
 */
router.post('/:taskId/execute', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;

    if (task.status === 'running') {
        return res.status(400).json(badRequest('이미 실행 중인 작업입니다.'));
    }
    if (task.status === 'completed') {
        return res.status(400).json(badRequest('이미 완료된 작업입니다. 새 작업을 생성하세요.'));
    }

    const tier: UserTier = (req.user && 'tier' in req.user)
        ? (req.user as { tier: UserTier }).tier
        : 'free';
    const role: UserRole = (req.user!.role as UserRole) || 'user';

    // 스킬 범위(allowedSkills): 이 실행에서 쓸 skill_id 목록 — 옵션. 문자열 배열만 수용,
    // 최대 50개로 캡. 미지정이면 전체 활성 스킬 사용(기존 동작).
    const rawSkills = (req.body as { allowedSkills?: unknown })?.allowedSkills;
    const allowedSkills = Array.isArray(rawSkills)
        ? rawSkills.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 200).slice(0, 50)
        : undefined;

    // 백그라운드 detached 실행 (응답은 즉시 반환). AgentTaskService 가 자체
    // AbortController 를 소유하므로 ws.close 와 무관하게 끝까지 진행한다.
    const service = new AgentTaskService();
    service.execute({
        taskId: task.id,
        goal: task.goal,
        userId: String(req.user!.id),
        userTier: tier,
        userRole: role,
        maxTurns: task.max_turns,
        allowedSkills,
    }).catch((error) => {
        logger.error(`[AgentTaskRoutes] 작업 실행 실패: ${error}`);
    });

    logger.info(`[AgentTaskRoutes] 작업 실행 시작: ${task.id}`);
    res.status(202).json(success({ message: '작업이 시작되었습니다.', taskId: task.id }));
}));

/**
 * POST /api/agent-tasks/:taskId/cancel
 * 실행 중 작업 취소
 */
router.post('/:taskId/cancel', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;

    const signaled = AgentTaskService.cancel(task.id);
    if (signaled) {
        // AbortController 신호됨 — execute 루프가 cancelled 로 상태 갱신
        return res.json(success({ message: '작업 취소를 요청했습니다.', taskId: task.id }));
    }

    // 레지스트리에 없음: DB 상 running 이면 비정상 종료로 보고 상태 정리, 아니면 취소 대상 아님
    if (task.status === 'running' || task.status === 'pending') {
        const db = getUnifiedDatabase();
        await db.updateAgentTask(task.id, { status: 'cancelled' });
        return res.json(success({ message: '작업이 취소되었습니다.', taskId: task.id }));
    }
    return res.status(400).json(badRequest('실행 중이거나 대기 중인 작업이 아닙니다.'));
}));

/**
 * POST /api/agent-tasks/:taskId/resume
 * 서버 재시작 등으로 중단된 작업을 end-of-turn checkpoint 에서 이어서 실행 (detached)
 */
router.post('/:taskId/resume', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;

    if (task.status === 'running') {
        return res.status(400).json(badRequest('이미 실행 중인 작업입니다.'));
    }
    const cp = task.checkpoint as { conversation?: unknown[]; completedTurn?: number } | null | undefined;
    if (!cp || !Array.isArray(cp.conversation) || cp.conversation.length === 0) {
        return res.status(400).json(badRequest('이어할 체크포인트가 없는 작업입니다.'));
    }

    const tier: UserTier = (req.user && 'tier' in req.user)
        ? (req.user as { tier: UserTier }).tier
        : 'free';
    const role: UserRole = (req.user!.role as UserRole) || 'user';
    const db = getUnifiedDatabase();
    const steps = await db.getAgentTaskSteps(task.id);

    const service = new AgentTaskService();
    service.execute({
        taskId: task.id,
        goal: task.goal,
        userId: String(req.user!.id),
        userTier: tier,
        userRole: role,
        maxTurns: task.max_turns,
        resume: {
            conversation: cp.conversation as ChatMessage[],
            fromTurn: (cp.completedTurn ?? 0) + 1,
            fromStep: steps.length,
        },
    }).catch((error) => {
        logger.error(`[AgentTaskRoutes] 이어하기 실패: ${error}`);
    });

    logger.info(`[AgentTaskRoutes] 작업 이어하기: ${task.id} (turn ${(cp.completedTurn ?? 0) + 1})`);
    res.status(202).json(success({ message: '작업을 이어서 시작했습니다.', taskId: task.id }));
}));

/**
 * DELETE /api/agent-tasks/:taskId
 * 작업 삭제 (실행 중이면 먼저 중단)
 */
router.delete('/:taskId', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;

    AgentTaskService.cancel(task.id);
    const db = getUnifiedDatabase();
    await db.deleteAgentTask(task.id);
    res.json(success({ message: '작업이 삭제되었습니다.', taskId: task.id }));
}));

export { router as agentTaskRouter };
export default router;
