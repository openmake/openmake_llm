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
import { buildShareDocument, type ShareStepInput, type ShareTaskInput } from '../services/agent-task/share-document';
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
async function buildFor(taskId: string, task: ShareTaskInput, opts: ShareToggles) {
    const steps = await getUnifiedDatabase().getAgentTaskSteps(taskId);
    return buildShareDocument(task, steps as unknown as ShareStepInput[], opts);
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

    const viewerId = req.user?.id ? String(req.user.id) : null;
    const isOwner = viewerId !== null && viewerId === share.owner_user_id;
    let allowed = isOwner;
    if (!allowed) {
        if (share.visibility === 'authenticated') allowed = viewerId !== null;
        else if (share.visibility === 'link') allowed = safeTokenEqual(String(req.query.token ?? ''), share.share_token);
    }
    if (!allowed) {
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

export default agentTaskShareRouter;
