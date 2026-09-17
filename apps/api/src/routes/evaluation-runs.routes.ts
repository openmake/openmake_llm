/**
 * 평가 실행 이력 (F26.1, 146) — 관리자 전용 조회. 기록은 평가 CLI(OMK_EVAL_RECORD_DB=true)가 한다.
 *
 * - GET /api/metrics/evaluations?runner=&mode=&limit=  — 최신순 목록(기본 50, 상한 200)
 * - GET /api/metrics/evaluations/:id                   — 1행 + 실패 케이스 요약
 *
 * @module routes/evaluation-runs.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler, AppError } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { EvalRunRepository } from '../data/repositories/eval-run-repository';

export const EVAL_RUNS_LIST = { DEFAULT_LIMIT: 50, MAX_LIMIT: 200 } as const;

const router = Router();
router.use(requireAuth, requireAdmin);

function optionalText(v: unknown): string | undefined {
    return typeof v === 'string' && /^[a-z_-]{1,32}$/.test(v) ? v : undefined;
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const n = Number(req.query.limit);
    const limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), EVAL_RUNS_LIST.MAX_LIMIT) : EVAL_RUNS_LIST.DEFAULT_LIMIT;
    const runner = optionalText(req.query.runner);
    const mode = optionalText(req.query.mode);
    const runs = await new EvalRunRepository(getPool()).list({ ...(runner ? { runner } : {}), ...(mode ? { mode } : {}), limit })
        .catch(() => []); // 146 적용 전 — 빈 목록
    res.json(success({ runs }));
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!/^\d{1,18}$/.test(id)) throw new AppError('id 는 숫자여야 합니다.', 400, true, 'INVALID_ID');
    const run = await new EvalRunRepository(getPool()).get(id);
    if (!run) throw new AppError('평가 실행을 찾을 수 없습니다.', 404, true, 'EVAL_RUN_NOT_FOUND');
    res.json(success({ run }));
}));

export { router as evaluationRunsRouter };
export default router;
