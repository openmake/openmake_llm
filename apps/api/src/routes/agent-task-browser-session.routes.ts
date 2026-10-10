/**
 * 브라우저 넘겨받기(Take control) 라우트 — agent-task.routes.ts 에서 router.use 로 마운트.
 *   GET    /api/agent-tasks/:taskId/browser-session             — 넘겨받은 상태인지(넘겨받을 수 없는 작업도 200 + eligible:false)
 *   POST   /api/agent-tasks/:taskId/browser-session { url? }    — 넘겨받기(세션 컨테이너 시작, 멱등)
 *   GET    /api/agent-tasks/:taskId/browser-session/screenshot  — 현재 화면(JPEG base64)·주소·제목
 *   POST   /api/agent-tasks/:taskId/browser-session/input       — 클릭·입력·키·스크롤·주소 이동·뒤로
 *   DELETE /api/agent-tasks/:taskId/browser-session             — 돌려주기(로그인 상태 저장 후 종료)
 *
 * 작업 소유자만 쓸 수 있다(관리자도 불가 — 사용자의 로그인된 브라우저다). 샌드박스(docker) 실행 작업만 대상이다.
 * @module routes/agent-task-browser-session
 */
import { Router, Request, Response } from 'express';
import { stat } from 'fs/promises';
import { createLogger } from '../utils/logger';
import { success, badRequest, forbidden, conflict } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getTaskSandboxConfig } from '../config/task-sandbox';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { loadOwnedTask } from './agent-task.helpers';
import {
    startBrowserSession, stopBrowserSession, isBrowserSessionActive, sendBrowserSessionCommand,
    browserSessionInputSchema, browserSessionStartSchema, lastBrowserUrl, isBlockedSessionUrl,
} from '../services/task-sandbox/browser-session';

const logger = createLogger('AgentTaskBrowserSessionRoutes');
export const browserSessionRouter = Router();

const BLOCKED_URL = '내부망·로컬 주소로는 이동할 수 없습니다. 공개 웹 주소만 열 수 있습니다.';
const NO_SESSION = '넘겨받은 브라우저 세션이 없습니다(유휴 상한이 지나 종료됐을 수 있습니다).';

type SessionTarget = { taskId: string; workdir: string };
/** 넘겨받을 수 없는 이유 — 상태 조회는 이것을 200 으로 돌려주고, 조작 라우트는 status 로 응답한다. */
type SessionIneligible = { status: 400 | 403; message: string; reason: 'not_owner' | 'not_sandbox' | 'workspace_gone' };

/** 소유자·실행 방식·작업 공간 검증 — 작업이 없거나 권한이 없으면(loadOwnedTask) 응답을 끝내고 undefined. */
async function resolveSessionTarget(req: Request, res: Response): Promise<SessionTarget | SessionIneligible | undefined> {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return undefined;
    if (String(task.user_id) !== String(req.user!.id)) {
        return { status: 403, message: '브라우저는 작업 소유자만 넘겨받을 수 있습니다.', reason: 'not_owner' };
    }
    const cfg = getTaskSandboxConfig();
    const workdir = (task as { workspace_path?: string | null }).workspace_path;
    if (!cfg.enabled || !cfg.browserEnabled || task.executor === 'local' || !workdir) {
        return { status: 400, message: '이 작업의 브라우저는 넘겨받을 수 없습니다(샌드박스에서 실행된 작업만 가능합니다).', reason: 'not_sandbox' };
    }
    if (!(await stat(workdir).then((s) => s.isDirectory(), () => false))) {
        return { status: 400, message: '작업 공간이 정리되어 브라우저를 넘겨받을 수 없습니다.', reason: 'workspace_gone' };
    }
    return { taskId: task.id, workdir };
}

function isIneligible(r: SessionTarget | SessionIneligible): r is SessionIneligible {
    return 'reason' in r;
}

/** 조작 라우트용 — 넘겨받을 수 없으면 400/403 으로 응답을 끝내고 undefined. */
async function loadSessionTarget(req: Request, res: Response): Promise<SessionTarget | undefined> {
    const r = await resolveSessionTarget(req, res);
    if (!r) return undefined;
    if (isIneligible(r)) {
        res.status(r.status).json(r.status === 403 ? forbidden(r.message) : badRequest(r.message));
        return undefined;
    }
    return r;
}

async function audit(req: Request, taskId: string, action: 'agent_task_browser_takeover' | 'agent_task_browser_release'): Promise<void> {
    try {
        const { getAuditService } = await import('../services/AuditService');
        await getAuditService().logAudit({ action, userId: String(req.user!.id), resourceType: 'agent_task', resourceId: taskId, details: {} });
    } catch { /* 감사 실패가 조작을 막지 않는다 */ }
}

browserSessionRouter.get('/:taskId/browser-session', asyncHandler(async (req: Request, res: Response) => {
    // 상태 조회는 작업 상세 화면이 모든 작업에 대해 부른다 — 넘겨받을 수 없는 작업(브라우저 꺼짐·로컬 실행·작업 공간 정리·
    // 다른 사용자 작업을 보는 관리자)은 오류가 아니라 "해당 없음"이므로 200 으로 알린다(400/403 은 브라우저 콘솔에 오류로 남았다).
    const target = await resolveSessionTarget(req, res);
    if (!target) return;
    if (isIneligible(target)) return res.json(success({ active: false, eligible: false, reason: target.reason }));
    res.json(success({ active: await isBrowserSessionActive(target.taskId), eligible: true }));
}));

browserSessionRouter.post('/:taskId/browser-session', asyncHandler(async (req: Request, res: Response) => {
    const target = await loadSessionTarget(req, res);
    if (!target) return;
    const body = browserSessionStartSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json(badRequest(body.error.issues[0]?.message ?? '잘못된 요청입니다.'));
    if (body.data.url && await isBlockedSessionUrl(body.data.url)) return res.status(400).json(badRequest(BLOCKED_URL));
    try {
        // 주소를 주지 않으면 에이전트가 마지막으로 연 곳에서 시작한다(막힌 화면을 바로 보게). 조회 실패·막힌 주소는 빈 화면으로.
        const last = body.data.url ? undefined
            : lastBrowserUrl(await getUnifiedDatabase().getAgentTaskSteps(target.taskId).catch(() => []));
        const startUrl = body.data.url ?? (last && !(await isBlockedSessionUrl(last)) ? last : undefined);
        await startBrowserSession(target.taskId, target.workdir, { startUrl });
    } catch (e) {
        logger.warn(`[${target.taskId}] 브라우저 세션 시작 실패: ${e instanceof Error ? e.message : String(e)}`);
        return res.status(409).json(conflict('브라우저 세션을 시작하지 못했습니다. 잠시 후 다시 시도하세요.'));
    }
    void audit(req, target.taskId, 'agent_task_browser_takeover');
    res.status(201).json(success({ active: true }));
}));

browserSessionRouter.get('/:taskId/browser-session/screenshot', asyncHandler(async (req: Request, res: Response) => {
    const target = await loadSessionTarget(req, res);
    if (!target) return;
    const r = await sendBrowserSessionCommand(target.taskId, { op: 'shot' });
    if (!r.ok || !r.image) {
        // 페이지 이동 중에는 캡처가 실패할 수 있다 — 세션이 살아 있으면 다음 폴링에서 다시 받는다
        if (await isBrowserSessionActive(target.taskId)) return res.json(success({ active: true, image: null, url: r.url ?? '', title: '' }));
        return res.status(409).json(conflict(NO_SESSION));
    }
    res.json(success({ active: true, image: r.image, url: r.url ?? '', title: r.title ?? '' }));
}));

browserSessionRouter.post('/:taskId/browser-session/input', asyncHandler(async (req: Request, res: Response) => {
    const target = await loadSessionTarget(req, res);
    if (!target) return;
    const input = browserSessionInputSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json(badRequest(input.error.issues[0]?.message ?? '잘못된 입력입니다.'));
    if (input.data.op === 'goto' && await isBlockedSessionUrl(input.data.url)) return res.status(400).json(badRequest(BLOCKED_URL));
    const r = await sendBrowserSessionCommand(target.taskId, input.data);
    if (!r.ok && !(await isBrowserSessionActive(target.taskId))) return res.status(409).json(conflict(NO_SESSION));
    // 세션은 살아 있는데 조작이 실패한 경우(이동 시간 초과 등)는 화면에 사유를 보여 준다
    res.json(success({ ok: r.ok, ...(r.ok ? {} : { error: r.error ?? 'failed' }) }));
}));

browserSessionRouter.delete('/:taskId/browser-session', asyncHandler(async (req: Request, res: Response) => {
    const target = await loadSessionTarget(req, res);
    if (!target) return;
    await stopBrowserSession(target.taskId);
    void audit(req, target.taskId, 'agent_task_browser_release');
    res.json(success({ active: false }));
}));
