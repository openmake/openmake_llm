/**
 * 대화 폴더 (F19.5, 157) — 로그인 사용자 본인 폴더만.
 *
 * - GET    /api/chat/folders          폴더 목록(세션 수 포함, position 순)
 * - POST   /api/chat/folders          {name} 생성 — 상한 CONVERSATION_LIMITS.MAX_FOLDERS_PER_USER, 같은 이름 409
 * - PATCH  /api/chat/folders/:id      {name?, position?}
 * - DELETE /api/chat/folders/:id      삭제 — 안의 세션은 미분류(folder_id NULL)로 남는다
 *
 * @module routes/conversation-folders.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { asyncHandler, AppError } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { createFolderSchema, updateFolderSchema } from '../schemas/conversation-organization.schema';
import {
    listFolders, createFolder, updateFolder, deleteFolder, FolderLimitError, FolderNameConflictError,
} from '../data/conversation-folders';

const router = Router();
router.use(requireAuth);

function userIdOf(req: Request): string {
    return String(req.user!.id);
}

function mapFolderError(e: unknown): never {
    if (e instanceof FolderLimitError) throw new AppError(e.message, 409, true, 'FOLDER_LIMIT');
    if (e instanceof FolderNameConflictError) throw new AppError(e.message, 409, true, 'FOLDER_NAME_CONFLICT');
    throw e;
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
    res.json(success({ folders: await listFolders(userIdOf(req)) }));
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
    const parsed = createFolderSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? '잘못된 입력입니다', 400, true, 'VALIDATION_ERROR');
    const folder = await createFolder(userIdOf(req), parsed.data.name).catch(mapFolderError);
    res.status(201).json(success({ folder }));
}));

router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateFolderSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? '잘못된 입력입니다', 400, true, 'VALIDATION_ERROR');
    const folder = await updateFolder(userIdOf(req), String(req.params.id), parsed.data).catch(mapFolderError);
    if (!folder) throw new AppError('폴더를 찾을 수 없습니다', 404, true, 'FOLDER_NOT_FOUND');
    res.json(success({ folder }));
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    const deleted = await deleteFolder(userIdOf(req), String(req.params.id));
    if (!deleted) throw new AppError('폴더를 찾을 수 없습니다', 404, true, 'FOLDER_NOT_FOUND');
    res.json(success({ deleted }));
}));

export default router;
