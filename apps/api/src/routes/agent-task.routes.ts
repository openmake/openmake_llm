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
import { validateWithSecurity } from '../middlewares/validation';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { v4 as uuidv4 } from 'uuid';
import { AgentTaskService, type AgentTaskInputFile } from '../services/AgentTaskService';
import type { ChatMessage } from '../llm/types';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { createAgentTaskSchema, type CreateAgentTaskInput } from '../schemas/agent-task.schema';
import { extractAttachedDocuments } from '../services/chat-service/doc-extractor';
import { getApprovalRegistry } from '../services/task-sandbox/approval-gate';
import { getSteeringRegistry } from '../services/agent-task/steering';
import { listUserRepos } from '../services/agent-task/git-ops';
import { dispatchAgentTask, getAgentTaskQueue } from '../services/agent-task/task-queue';
import { safeRealWorkspacePath, listWorkspaceFilesAt } from '../services/task-sandbox/sandbox';
import { basename } from 'path';

const logger = createLogger('AgentTaskRoutes');
const router = Router();

// 모든 엔드포인트 인증 필요
router.use(requireAuth);

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

/** 응답용 변환: 큰 checkpoint/input_files/input_images 본문 제거 + resumable 플래그(중단된 작업에 체크포인트 존재).
 *  input_files 는 내용(content/data)을 뺀 메타(name/type/size)만 노출 — 목록/상세 응답 팽창 방지. */
function toPublicTask(t: Record<string, unknown>) {
    const { checkpoint, input_files, input_images, ...rest } = t;
    void input_images; // dataURL 배열 — 응답에서 제외(팽창 방지)
    const fileMetas = Array.isArray(input_files)
        ? (input_files as AgentTaskInputFile[]).map((f) => ({ name: f?.name, type: f?.type, size: f?.size }))
        : undefined;
    return { ...rest, ...(fileMetas ? { input_files: fileMetas } : {}), resumable: !!checkpoint && t.status === 'failed' };
}

/**
 * POST /api/agent-tasks
 * 작업 생성
 */
// body 상한은 express.json 파서와 동일 상수 공유 — validate 기본값(1MB)이 파서 상한을
// 무력화해 대용량 첨부가 "요청 본문이 너무 큽니다" 로 거부되던 정합 버그 방지.
router.post('/', validateWithSecurity(createAgentTaskSchema, {
    maxBodySizeBytes: AGENT_TASK_LIMITS.REQUEST_BODY_MAX_BYTES,
}), asyncHandler(async (req: Request, res: Response) => {
    const { goal, maxTurns, files, images, repoUrl, branch } = req.body as CreateAgentTaskInput;

    const taskId = uuidv4();
    const db = getUnifiedDatabase();
    const userId = String(req.user!.id);

    // 입력 첨부: 바이너리 문서(base64 data)는 지금 텍스트로 추출해 저장한다 —
    // 실행은 detached 백그라운드라 여기서 추출해야 실패를 생성 응답에서 인지 가능하다.
    // base64 원본도 함께 보존해 실행 시 샌드박스 uploads/ 에 원본 바이트로 기록
    // (에이전트가 openpyxl 등으로 직접 파싱). 응답에선 toPublicTask 가 메타만 노출.
    let inputFiles: AgentTaskInputFile[] | undefined;
    if (Array.isArray(files) && files.length > 0) {
        const originalData = files.map((f) => (typeof f.data === 'string' && f.data.length > 0 ? f.data : undefined));
        await extractAttachedDocuments(files); // in-place: data → content 추출 후 data 제거
        inputFiles = files.map((f, i) => ({
            name: f.name,
            type: f.type,
            content: f.content,
            size: f.size,
            truncated: f.truncated,
            ...(originalData[i] ? { data: originalData[i] } : {}),
            ...(originalData[i] && typeof f.content === 'string' ? { extracted: true } : {}),
        }));
    }

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
        inputFiles,
        inputImages: Array.isArray(images) && images.length > 0 ? images : undefined,
        gitRepoUrl: repoUrl,
        gitBranch: branch,
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
 * GET /api/agent-tasks/github/repos
 * 저장된 GitHub 토큰으로 사용자의 repo 목록(push 권한) 조회 — composer repo 자동완성용.
 * 토큰 미연결이면 빈 배열. ⚠️ GET /:taskId 보다 먼저 등록(github 가 taskId 로 매칭되지 않게).
 */
router.get('/github/repos', asyncHandler(async (req: Request, res: Response) => {
    const repos = await listUserRepos(String(req.user!.id));
    res.json(success({ repos }));
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

    // paused = 승인 대기로 일시정지된 채 루프가 살아있는 상태 — 동일 task 이중 실행 차단.
    // queued = 이미 큐에 올라 실행 대기 중 — 중복 제출 차단.
    if (task.status === 'running' || task.status === 'paused' || task.status === 'queued') {
        return res.status(400).json(badRequest('이미 실행 중(또는 대기·승인 대기 중)인 작업입니다.'));
    }
    if (task.status === 'completed') {
        return res.status(400).json(badRequest('이미 완료된 작업입니다. 새 작업을 생성하세요.'));
    }

    const role: UserRole = (req.user!.role as UserRole) || 'user';

    // 스킬 범위(allowedSkills): 이 실행에서 쓸 skill_id 목록 — 옵션. 문자열 배열만 수용,
    // 최대 50개로 캡. 미지정이면 전체 활성 스킬 사용(기존 동작).
    const rawSkills = (req.body as { allowedSkills?: unknown })?.allowedSkills;
    const allowedSkills = Array.isArray(rawSkills)
        ? rawSkills.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 200).slice(0, 50)
        : undefined;

    // 승인 3모드(Manual/Auto/Skip) — 이 실행에만 적용할 승인 정책(옵션). 유효 enum 만 수용.
    const rawPolicy = (req.body as { approvalPolicy?: unknown })?.approvalPolicy;
    const approvalPolicy = rawPolicy === 'all' || rawPolicy === 'high-risk' || rawPolicy === 'none'
        ? rawPolicy : undefined;

    // 백그라운드 detached 실행 (응답은 즉시 반환). AgentTaskService 가 자체
    // AbortController 를 소유하므로 ws.close 와 무관하게 끝까지 진행한다.
    // 큐(3-B) 활성 시 동시 실행 상한을 넘으면 'queued' 로 대기 후 슬롯이 비면 실행된다.
    const service = new AgentTaskService();
    const outcome = await dispatchAgentTask({
        taskId: task.id,
        userId: String(req.user!.id),
        run: () => service.execute({
            taskId: task.id,
            goal: task.goal,
            userId: String(req.user!.id),
            userRole: role,
            maxTurns: task.max_turns,
            allowedSkills,
            approvalPolicy,
            files: Array.isArray(task.input_files) ? task.input_files as AgentTaskInputFile[] : undefined,
            images: Array.isArray(task.input_images) ? task.input_images as string[] : undefined,
            gitRepoUrl: task.git_repo_url ?? undefined,
            gitBranch: task.git_branch ?? undefined,
        }),
    });

    logger.info(`[AgentTaskRoutes] 작업 ${outcome === 'queued' ? '대기열 등록' : '실행 시작'}: ${task.id}`);
    res.status(202).json(success({
        message: outcome === 'queued' ? '동시 실행 한도로 대기열에 추가되었습니다.' : '작업이 시작되었습니다.',
        taskId: task.id,
        queued: outcome === 'queued',
    }));
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

    // 실행 전 대기열(queued)에 있으면 큐에서 제거 후 상태 정리(아직 execute 미시작이라 AbortController 없음).
    const dequeued = getAgentTaskQueue().cancelPending(task.id);

    // 레지스트리에 없음: DB 상 running/queued/pending 이면 상태 정리, 아니면 취소 대상 아님
    if (dequeued || task.status === 'running' || task.status === 'pending' || task.status === 'queued') {
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

    if (task.status === 'running' || task.status === 'paused' || task.status === 'queued') {
        return res.status(400).json(badRequest('이미 실행 중(또는 대기·승인 대기 중)인 작업입니다.'));
    }
    // 완료 작업 재개 차단 — 신규 완료분은 checkpoint 가 정리되지만 legacy 행 방어.
    if (task.status === 'completed') {
        return res.status(400).json(badRequest('이미 완료된 작업입니다. 새 작업을 생성하세요.'));
    }
    const cp = task.checkpoint as { conversation?: unknown[]; completedTurn?: number } | null | undefined;
    if (!cp || !Array.isArray(cp.conversation) || cp.conversation.length === 0) {
        return res.status(400).json(badRequest('이어할 체크포인트가 없는 작업입니다.'));
    }

    const role: UserRole = (req.user!.role as UserRole) || 'user';
    const db = getUnifiedDatabase();
    const steps = await db.getAgentTaskSteps(task.id);

    const service = new AgentTaskService();
    const outcome = await dispatchAgentTask({
        taskId: task.id,
        userId: String(req.user!.id),
        run: () => service.execute({
            taskId: task.id,
            goal: task.goal,
            userId: String(req.user!.id),
            userRole: role,
            maxTurns: task.max_turns,
            files: Array.isArray(task.input_files) ? task.input_files as AgentTaskInputFile[] : undefined,
            images: Array.isArray(task.input_images) ? task.input_images as string[] : undefined,
            gitRepoUrl: task.git_repo_url ?? undefined,
            gitBranch: task.git_branch ?? undefined,
            resume: {
                conversation: cp.conversation as ChatMessage[],
                fromTurn: (cp.completedTurn ?? 0) + 1,
                fromStep: steps.length,
            },
        }),
    });

    logger.info(`[AgentTaskRoutes] 작업 이어하기 ${outcome === 'queued' ? '대기열 등록' : '시작'}: ${task.id} (turn ${(cp.completedTurn ?? 0) + 1})`);
    res.status(202).json(success({
        message: outcome === 'queued' ? '동시 실행 한도로 대기열에 추가되었습니다.' : '작업을 이어서 시작했습니다.',
        taskId: task.id,
        queued: outcome === 'queued',
    }));
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

/**
 * POST /api/agent-tasks/:taskId/steer  { message }
 * 실행 중 중간 지시(steering) — 실행 중 task 에 방향 지시를 주입. 다음 턴 경계에서 conversation
 * 에 user 메시지로 반영된다(취소·재시작 불요). running/paused/queued 상태에서만 유효. owner/admin 만.
 */
router.post('/:taskId/steer', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    if (!AGENT_TASK_LIMITS.STEERING_ENABLED) {
        return res.status(400).json(badRequest('중간 지시 기능이 비활성화되어 있습니다.'));
    }
    if (task.status !== 'running' && task.status !== 'paused' && task.status !== 'queued') {
        return res.status(400).json(badRequest('실행 중인 작업에만 지시를 보낼 수 있습니다.'));
    }
    const message = String((req.body as { message?: unknown })?.message ?? '').trim();
    if (!message) return res.status(400).json(badRequest('message 가 필요합니다.'));
    if (message.length > AGENT_TASK_LIMITS.STEERING_MAX_CHARS) {
        return res.status(400).json(badRequest(`지시는 ${AGENT_TASK_LIMITS.STEERING_MAX_CHARS}자를 넘을 수 없습니다.`));
    }
    const ok = getSteeringRegistry().submit(task.id, message, AGENT_TASK_LIMITS.STEERING_MAX_PENDING);
    if (!ok) return res.status(429).json(badRequest('대기 중인 지시가 너무 많습니다. 반영된 후 다시 시도하세요.'));
    logger.info(`[AgentTaskRoutes] steering 접수: ${task.id} (user ${req.user!.id})`);
    res.json(success({ taskId: task.id, queued: getSteeringRegistry().count(task.id) }));
}));

/**
 * GET /api/agent-tasks/:taskId/files
 * 완료된 task 의 workspace 산출물 파일 목록 (상대경로). 완료 시 workspace 보존됨.
 */
router.get('/:taskId/files', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const wp = (task as { workspace_path?: string }).workspace_path;
    if (!wp) return res.json(success({ files: [] }));
    const files = await listWorkspaceFilesAt(wp);
    res.json(success({ files }));
}));

/**
 * GET /api/agent-tasks/:taskId/files/download?path=relative/path
 * workspace 내 단일 파일 다운로드. 경로 탈출 가드 + owner 검증.
 */
router.get('/:taskId/files/download', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const wp = (task as { workspace_path?: string }).workspace_path;
    const rel = String(req.query.path || '');
    if (!wp || !rel) return res.status(400).json(badRequest('path 가 필요합니다.'));
    let abs: string;
    try {
        // 실경로 검증 — 에이전트가 workspace 안에 만든 심링크를 따라 호스트 파일이 유출되는 것을 차단.
        abs = await safeRealWorkspacePath(wp, rel);
    } catch {
        return res.status(400).json(badRequest('잘못된 경로입니다.'));
    }
    // 전역 setupSecurity 가 /api 응답에 Content-Type: application/json 을 미리 박아두므로,
    // res.download(sendFile)이 확장자 기반 MIME 으로 덮어쓰지 못한다(이미 설정된 헤더는 유지).
    // 헤더를 제거해 sendFile 의 확장자 자동 감지(.xlsx/.pdf 등)를 복원한다.
    res.removeHeader('Content-Type');
    res.download(abs, basename(rel), (err) => {
        if (err && !res.headersSent) res.status(404).json(notFound('파일을 찾을 수 없습니다.'));
    });
}));

/**
 * POST /api/agent-tasks/:taskId/approvals/auto-approve  { enabled?: boolean }
 * task 자동승인(4-2) — 이후 이 task 의 도구 승인 요청을 즉시 approved 처리("나머지 모두 승인").
 * ask_human 은 제외(질문은 항상 사람에게). 현재 대기 중인 승인들도 즉시 해소.
 * task 종료 시 자동 해제. owner/admin 만 가능.
 */
router.post('/:taskId/approvals/auto-approve', asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const enabled = (req.body as { enabled?: unknown })?.enabled !== false;
    getApprovalRegistry().setAutoApprove(task.id, enabled);
    logger.info(`[AgentTaskRoutes] 자동승인 ${enabled ? '활성' : '해제'}: ${task.id} (user ${req.user!.id})`);
    res.json(success({ taskId: task.id, autoApprove: enabled }));
}));

/**
 * GET /api/agent-tasks/approvals/pending
 * 현재 사용자의 승인 대기 도구 호출 목록 (HITL 게이트 — 전부-승인 정책).
 */
router.get('/approvals/pending', asyncHandler(async (req: Request, res: Response) => {
    const pending = getApprovalRegistry().list(String(req.user!.id));
    res.json(success({ pending }));
}));

/**
 * POST /api/agent-tasks/approvals/:approvalId/answer  { text }
 * ask_human 질문에 자유텍스트로 응답 — 진행(approved)으로 해소하되 답변 본문을 에이전트에 전달.
 * (승인/거절 이진 응답의 한계를 보완하는 HITL 답변 채널.)
 * ⚠️ 아래 `/:decision` 라우트보다 반드시 먼저 등록 — 뒤에 두면 'answer' 가 :decision 으로
 *    매칭돼 400 이 난다(라이브 검증에서 발견된 라우트 순서 버그).
 */
router.post('/approvals/:approvalId/answer', asyncHandler(async (req: Request, res: Response) => {
    const { approvalId } = req.params;
    const text = String((req.body as { text?: unknown })?.text ?? '').trim();
    if (!text) return res.status(400).json(badRequest('text 가 필요합니다.'));
    if (text.length > 4000) return res.status(400).json(badRequest('답변은 4000자를 넘을 수 없습니다.'));
    const registry = getApprovalRegistry();
    const pending = registry.get(approvalId);
    if (!pending) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    assertResourceOwnerOrAdmin(pending.userId, String(req.user!.id), req.user!.role || 'user');

    const ok = registry.answer(approvalId, text);
    if (!ok) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    res.json(success({ approvalId, answered: true }));
}));

/**
 * POST /api/agent-tasks/approvals/:approvalId/:decision  (decision = approve | reject)
 * 대기 중인 도구 호출을 승인/거절 — 해당 approval 의 owner 만 가능.
 */
router.post('/approvals/:approvalId/:decision', asyncHandler(async (req: Request, res: Response) => {
    const { approvalId, decision } = req.params;
    if (decision !== 'approve' && decision !== 'reject') {
        return res.status(400).json(badRequest("decision 은 approve | reject 여야 합니다."));
    }
    const registry = getApprovalRegistry();
    const pending = registry.get(approvalId);
    if (!pending) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    assertResourceOwnerOrAdmin(pending.userId, String(req.user!.id), req.user!.role || 'user');

    const ok = decision === 'approve' ? registry.approve(approvalId) : registry.reject(approvalId);
    if (!ok) return res.status(404).json(notFound('대기 중인 승인 요청을 찾을 수 없습니다(만료 가능).'));
    res.json(success({ approvalId, decision }));
}));

export { router as agentTaskRouter };
export default router;
