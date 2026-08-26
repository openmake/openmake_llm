/**
 * 에이전트 작업 읽기 전용 공유 — mount: `/api` (경로에 `agent-tasks`/`shared-tasks` 를 모두 포함).
 *
 *   GET    /api/agent-tasks/:taskId/share          — 현재 공유 상태(소유자, 없으면 null)
 *   POST   /api/agent-tasks/:taskId/share/preview  — 게시 없이 공유 문서 미리보기(소유자)
 *   POST   /api/agent-tasks/:taskId/share          — 스냅샷 확정 게시(소유자)
 *   DELETE /api/agent-tasks/:taskId/share          — 공유 해제(소유자)
 *   GET    /api/shared-tasks/:shareId              — 조회(visibility 별 authz)
 *
 * 설계(plan `2026-08-26-agent-task-share-plan.md`):
 *   - 원본을 통째로 내보내지 않는다 — `buildShareDocument` 가 allowlist 로 새 문서를 만들고
 *     `redactText` 가 남은 텍스트를 정화한다. 둘 다 보조일 뿐, 안전의 본선은 **미리보기 →
 *     명시 확인 → 게시 시점 스냅샷** 이다.
 *   - 라이브 조인 금지: 게시 후 작업을 resume 해도 공유본은 그 시점 그대로다.
 *   - `agent-task.routes.ts` 가 Gate 3(600줄)에 근접해 별도 파일로 둔다.
 *
 * @module routes/agent-task-share.routes
 */
import { Router, Request, Response } from 'express';
import { randomUUID, randomBytes, timingSafeEqual } from 'crypto';
import { optionalAuth } from '../auth';
import { requireAuthOrApiKeyScope } from '../middlewares/api-key-auth';
import { API_KEY_SCOPES } from '../config/api-key-scopes';
import { success, badRequest, notFound } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { AgentTaskShareRepository, type ShareVisibility } from '../data/repositories/agent-task-share-repository';
import { buildShareDocument, extractArtifactViewerContents, type ShareDocument, type ShareStepInput, type ShareTaskInput } from '../services/agent-task/share-document';
import { exportShareArtifactViewers, removeShareArtifactViewers } from '../services/agent-task/share-artifact-viewer';
import { ARTIFACT_VIEWER } from '../config/artifact-viewer';
import { mintAccessToken } from '../services/artifact-viewer-service';
import { loadOwnedTask } from './agent-task.helpers';
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentTaskShareRoutes');

export const agentTaskShareRouter = Router();

/**
 * 소유자 전용 라우트의 인증 — JWT(웹) 또는 `bridge` 스코프 API key(CLI).
 * 작업 본 라우트(`agent-task.routes.ts`)와 같은 축이라야 CLI 가 자기 작업을 공유할 수 있다.
 * 공개 조회(`/shared-tasks/:shareId`)는 예외로 `optionalAuth` 다.
 */
const requireOwner = requireAuthOrApiKeyScope(API_KEY_SCOPES.BRIDGE);

const VALID_VISIBILITY: ShareVisibility[] = ['private', 'authenticated', 'link'];

/** 타이밍 공격 방어 — 아티팩트 공유와 동일 규칙. */
function safeTokenEqual(provided: string, expected: string | null | undefined): boolean {
    if (!expected) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

function repo(): AgentTaskShareRepository {
    return new AgentTaskShareRepository(getUnifiedDatabase().getPool());
}

/** 작업 + 스텝을 읽어 공유 문서를 만든다(게시/미리보기 공용). */
async function buildFor(taskId: string, task: ShareTaskInput, opts: ShareToggles): Promise<ShareDocument> {
    const steps = await getUnifiedDatabase().getAgentTaskSteps(taskId);
    return buildShareDocument(task, steps as unknown as ShareStepInput[], opts);
}

/** 뷰어 export 용 산출물 원본 — 문서의 artifacts 와 인덱스 정렬된다. */
async function artifactContentsFor(taskId: string): Promise<(string | null)[]> {
    const steps = await getUnifiedDatabase().getAgentTaskSteps(taskId);
    return extractArtifactViewerContents(steps as unknown as ShareStepInput[]);
}

interface ShareToggles { includeSteps: boolean; includeDiff: boolean; includeArtifacts: boolean }

/** 범위 토글 — 모두 기본 포함(공유 가치가 큰 쪽), 명시 false 일 때만 제외. */
function readToggles(body: unknown): ShareToggles {
    const b = (body ?? {}) as { includeSteps?: unknown; includeDiff?: unknown; includeArtifacts?: unknown };
    return {
        includeSteps: b.includeSteps !== false,
        includeDiff: b.includeDiff !== false,
        includeArtifacts: b.includeArtifacts !== false,
    };
}

/**
 * 조회 인가 — 소유자 / authenticated(로그인) / link(토큰 일치). 조회와 산출물 열람이
 * **같은 규칙**을 쓰도록 한 곳에 둔다(둘이 어긋나면 산출물이 공유보다 넓게 열린다).
 */
function isShareViewerAllowed(req: Request, share: { owner_user_id: string; visibility: ShareVisibility; share_token: string | null }): boolean {
    const viewerId = req.user?.id ? String(req.user.id) : null;
    if (viewerId !== null && viewerId === share.owner_user_id) return true;
    if (share.visibility === 'authenticated') return viewerId !== null;
    if (share.visibility === 'link') return safeTokenEqual(String(req.query.token ?? ''), share.share_token);
    return false;
}

/** 공유 링크 경로 — 응답 3곳(게시·조회·CLI)이 같은 형태를 쓰도록 한 곳에서 만든다. */
function sharePath(shareId: string, token: string | null): string {
    return `/shared/task/${shareId}${token ? `?token=${token}` : ''}`;
}

/**
 * 현재 공유 상태 — 없으면 `share: null`. UI/CLI 가 "이미 공유 중인가"를 알아야
 * 링크 복사·해제를 보여줄 수 있다(게시 응답만으로는 새로고침 후 상태를 잃는다).
 */
agentTaskShareRouter.get('/agent-tasks/:taskId/share', requireOwner, asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const row = await repo().getByTaskId(req.params.taskId);
    res.json(success({
        share: row ? {
            shareId: row.share_id,
            visibility: row.visibility,
            shareToken: row.share_token,
            includeSteps: row.include_steps,
            includeDiff: row.include_diff,
            includeArtifacts: row.include_artifacts,
            sharedAt: row.updated_at,
            path: sharePath(row.share_id, row.share_token),
        } : null,
    }));
}));

/**
 * 미리보기 — 게시하지 않는다. 사용자가 **실제 공개될 내용 그대로** 확인한 뒤에만 게시하도록
 * 하는 것이 이 기능의 안전 장치다(자동 redaction 은 완전하지 않다).
 */
agentTaskShareRouter.post('/agent-tasks/:taskId/share/preview', requireOwner, asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const doc = await buildFor(req.params.taskId, task as unknown as ShareTaskInput, readToggles(req.body));
    res.json(success({ preview: doc }));
}));

/**
 * 게시 — 미리보기와 **같은 입력으로 다시 조립해** 스냅샷으로 저장한다.
 * 기본 visibility 는 `private`(링크 생성은 명시 선택) — 실수로 공개되는 쪽보다 안 보이는 쪽이 낫다.
 */
agentTaskShareRouter.post('/agent-tasks/:taskId/share', requireOwner, asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;

    const body = (req.body ?? {}) as { visibility?: string };
    const visibility = (body.visibility ?? 'private') as ShareVisibility;
    if (!VALID_VISIBILITY.includes(visibility)) {
        res.status(400).json(badRequest(`visibility 는 ${VALID_VISIBILITY.join('|')} 중 하나여야 합니다`));
        return;
    }

    const toggles = readToggles(req.body);
    const snapshot = await buildFor(req.params.taskId, task as unknown as ShareTaskInput, toggles);

    // 기존 공유가 있으면 share_id 를 유지한다 — 이미 퍼진 링크가 죽지 않게.
    const existing = await repo().getByTaskId(req.params.taskId);
    const shareId = existing?.share_id ?? randomUUID();
    // link 로 바뀔 때만 토큰을 만든다. 이미 link 였으면 기존 토큰 유지(링크 보존).
    const shareToken = visibility === 'link'
        ? (existing?.visibility === 'link' && existing.share_token ? existing.share_token : randomBytes(24).toString('base64url'))
        : null;

    // 재게시면 이전 export 를 먼저 지운다(산출물 수가 줄면 옛 페이지가 남는다).
    if (existing) {
        const prev = (existing.snapshot as ShareDocument | null)?.artifacts?.length ?? 0;
        await removeShareArtifactViewers(shareId, prev);
    }
    // 격리 오리진에 산출물 뷰어를 export 하고 viewerId 를 스냅샷에 심는다(fail-open).
    if (toggles.includeArtifacts && snapshot.artifacts.length > 0) {
        await exportShareArtifactViewers(shareId, String(req.user!.id), snapshot.artifacts, await artifactContentsFor(req.params.taskId));
    }

    const row = await repo().upsert({
        shareId,
        taskId: req.params.taskId,
        ownerUserId: String(req.user!.id),
        visibility,
        shareToken,
        snapshot,
        includeDiff: toggles.includeDiff,
        includeSteps: toggles.includeSteps,
        includeArtifacts: toggles.includeArtifacts,
    });

    logger.info(`작업 공유 게시: ${req.params.taskId} (${visibility}, steps=${toggles.includeSteps}, diff=${toggles.includeDiff}, artifacts=${toggles.includeArtifacts})`);
    res.json(success({
        shareId: row.share_id,
        visibility: row.visibility,
        shareToken: row.share_token,
        path: sharePath(row.share_id, row.share_token),
    }));
}));

/** 공유 해제 — 이후 조회는 404. */
agentTaskShareRouter.delete('/agent-tasks/:taskId/share', requireOwner, asyncHandler(async (req: Request, res: Response) => {
    const task = await loadOwnedTask(req, res, req.params.taskId);
    if (!task) return;
    const existing = await repo().getByTaskId(req.params.taskId);
    if (existing) {
        await removeShareArtifactViewers(existing.share_id, (existing.snapshot as ShareDocument | null)?.artifacts?.length ?? 0);
    }
    const deleted = await repo().deleteByTaskId(req.params.taskId);
    logger.info(`작업 공유 해제: ${req.params.taskId} (${deleted ? '삭제됨' : '없음'})`);
    res.json(success({ unshared: deleted }));
}));

/**
 * 공유 조회 — visibility 별 authz. 아티팩트 공유와 같은 규칙:
 *   private       : 소유자만
 *   authenticated : 로그인 사용자
 *   link          : `?token` 이 share_token 과 일치하면 비인증도 허용
 * 존재 여부 자체를 숨기기 위해 권한 실패는 **404** 로 응답한다(403 이면 "그 작업은 있다"가 샌다).
 */
agentTaskShareRouter.get('/shared-tasks/:shareId', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    const share = await repo().getByShareId(req.params.shareId);
    if (!share) {
        res.status(404).json(notFound('공유된 작업'));
        return;
    }

    if (!isShareViewerAllowed(req, share)) {
        res.status(404).json(notFound('공유된 작업'));
        return;
    }

    res.json(success({
        shareId: share.share_id,
        visibility: share.visibility,
        sharedAt: share.updated_at,
        document: share.snapshot,
    }));
}));

/**
 * 산출물 열람 URL 발급 — 공유와 **같은 인가**를 통과한 뒤에만 격리 오리진 접근토큰을 준다.
 *
 * 토큰을 스냅샷에 박아두지 않는 이유: 스냅샷은 조회 응답으로 그대로 나가므로, 박아두면
 * 공유 문서를 한 번 본 사람이 인가와 무관하게 영구 URL 을 갖게 된다. 여기서 발급하는
 * 접근토큰은 TTL 이 있고, 공유를 해제하면 export 자체가 사라져 404 다.
 */
agentTaskShareRouter.get('/shared-tasks/:shareId/artifacts/:index/open', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    const share = await repo().getByShareId(req.params.shareId);
    if (!share || !isShareViewerAllowed(req, share)) {
        res.status(404).json(notFound('공유된 작업'));
        return;
    }
    const doc = share.snapshot as ShareDocument | null;
    const artifact = doc?.artifacts?.[Number(req.params.index)];
    if (!artifact?.viewerId) {
        res.status(404).json(notFound('산출물'));
        return;
    }
    const token = mintAccessToken(artifact.viewerId);
    if (!token) {
        res.status(404).json(notFound('산출물 뷰어'));
        return;
    }
    res.json(success({ url: `${ARTIFACT_VIEWER.origin}/a/${artifact.viewerId}/?k=${encodeURIComponent(token)}` }));
}));

export default agentTaskShareRouter;
