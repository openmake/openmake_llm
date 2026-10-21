/**
 * 실시간 작업 화면 조회 라우트 — agent-task.routes.ts 에서 router.use 로 마운트.
 *   GET /api/agent-tasks/:taskId/live[?frameAt=<ms>] — 실행 중 브라우저 화면(JPEG base64)·주소·제목과 터미널 출력 꼬리
 *     frameAt 이 현재 프레임 시각과 같으면 이미지 없이 browser.unchanged:true 로 답한다.
 *
 * 작업 소유자만 볼 수 있다(관리자도 불가 — 사용자의 로그인된 화면이 비칠 수 있다). 샌드박스(docker) 실행 작업만 대상이다.
 * 대상이 아닌 작업도 오류가 아니라 200 + eligible:false 로 알린다(화면이 1초마다 부른다 — 넘겨받기 상태 조회와 같은 원칙).
 * @module routes/agent-task-live
 */
import { Router, Request, Response } from 'express';
import { stat } from 'fs/promises';
import { success } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getTaskSandboxConfig } from '../config/task-sandbox';
import { LIVE_VIEW } from '../config/agent-task-live-view';
import { loadOwnedTask } from './agent-task.helpers';
import { readLiveView } from '../services/task-sandbox/live-view';

export const liveViewRouter = Router();

/** 선택 쿼리 frameAt(ms) — 숫자가 아니면(빈 값·배열 포함) 무시한다. */
function parseFrameAt(q: unknown): number | undefined {
    if (typeof q !== 'string' || q.trim() === '') return undefined;
    const n = Number(q);
    return Number.isFinite(n) ? n : undefined;
}

type LiveIneligibleReason = 'not_owner' | 'disabled' | 'not_sandbox' | 'workspace_gone';

liveViewRouter.get('/:taskId/live', asyncHandler(async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const ineligible = (reason: LiveIneligibleReason) => res.json(success({ eligible: false, reason }));
    // loadOwnedTask 는 관리자를 통과시킨다 — 화면은 소유자만
    if (String(task.user_id) !== String(req.user!.id)) return ineligible('not_owner');
    if (!LIVE_VIEW.ENABLED) return ineligible('disabled');
    // browserEnabled 는 보지 않는다 — 브라우저가 꺼져도 터미널은 보인다
    const cfg = getTaskSandboxConfig();
    const workdir = (task as { workspace_path?: string | null }).workspace_path;
    if (!cfg.enabled || task.executor === 'local' || !workdir) return ineligible('not_sandbox');
    if (!(await stat(workdir).then((s) => s.isDirectory(), () => false))) return ineligible('workspace_gone');
    res.json(success({ eligible: true, status: task.status, ...(await readLiveView(workdir, { frameAt: parseFrameAt(req.query.frameAt) })) }));
}));
