/**
 * 생성 산출물 전달 — `/generated/<name>` 의 **인증된 mapping handler** (Base·Add-on 통합 P04, 2026-09-23).
 *
 * 종전엔 express.static 이 공개 root 를 그대로 내렸다(누구나 어떤 파일이든). 이제 이 라우터가 static 앞에 서서
 * `runtime-ports/artifact-store` 의 소유권 판정을 지난 뒤에만 파일을 내려준다 — 백엔드 직결과 Next rewrite(`/generated/:path*`)
 * 경유가 같은 핸들러를 지난다(T28). 예약 리포트 게시(`/generated/reports/*`)는 공개 유지 — static 으로 넘긴다.
 * `?download=1` 은 종전대로 첨부 헤더. 인증은 쿠키(브라우저)·Bearer(optionalAuth)·전달 티켓(`?t=`) 셋 중 하나.
 *
 * @module routes/generated-artifacts.routes
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import * as path from 'node:path';
import { optionalAuth, requireAuth } from '../auth';
import { GENERATED_NAME_PATTERN } from '../tools/generated-media';
import { issueDeliveryTicket, resolveArtifactForRead } from '../runtime-ports/artifact-store';
import { asyncHandler } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { GENERATED_ARTIFACT_LIMITS } from '../config/runtime-limits';

const REPORTS_PREFIX = '/reports/';

function viewerOf(req: Request): { userId?: string; isAdmin?: boolean; ticket?: string } {
    const user = req.user as { id?: string | number; role?: string } | undefined;
    const ticket = typeof req.query.t === 'string' ? req.query.t : undefined;
    return { userId: user?.id !== undefined ? String(user.id) : undefined, isAdmin: user?.role === 'admin', ticket };
}

/** `/generated` 에 마운트 — static 보다 앞 */
export const generatedArtifactsRouter = Router();
// 정적 서빙 설정이 본문·쿠키 파서보다 앞에 걸리므로 쿠키는 여기서 직접 읽는다(이미 파싱돼 있으면 no-op)
generatedArtifactsRouter.use(cookieParser());

generatedArtifactsRouter.get('/*path', (req: Request, res: Response, next: NextFunction) => {
    // 예약 리포트 게시물은 공개 정적 자산 그대로
    if (req.path.startsWith(REPORTS_PREFIX)) { next(); return; }
    void optionalAuth(req, res, () => {
        const name = path.basename(req.path);
        if (!GENERATED_NAME_PATTERN.test(name) || req.path !== `/${name}`) { res.status(404).end(); return; }
        resolveArtifactForRead(name, viewerOf(req)).then((v) => {
            if (!v.ok) {
                res.status(v.status).json({ success: false, error: { code: v.reason.toUpperCase(), message: v.reason === 'isolated' ? '소유권을 확인할 수 없는 산출물입니다' : v.reason } });
                return;
            }
            if (req.query.download === '1') res.attachment(name);
            res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.type(v.mime);
            res.sendFile(v.absPath);
        }).catch(next);
    });
});

/** `/api/generated` 에 마운트 — bearer 전용 클라이언트가 `<img>` 에 붙일 전달 티켓 URL */
export const generatedTicketRouter = Router();

generatedTicketRouter.get('/:name/ticket', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name;
    const v = await resolveArtifactForRead(name, viewerOf(req));
    if (!v.ok) { res.status(v.status).json({ success: false, error: { code: v.reason.toUpperCase(), message: v.reason } }); return; }
    const ticket = issueDeliveryTicket(name);
    res.json(success({ url: `/generated/${name}?t=${encodeURIComponent(ticket)}`, expiresInMs: GENERATED_ARTIFACT_LIMITS.TICKET_TTL_MS }));
}));
