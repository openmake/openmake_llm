/**
 * ============================================================
 * Memory Routes - 장기 메모리 관리 API 라우트
 * ============================================================
 *
 * 사용자별 장기 기억 시스템의 CRUD, 검색, 카테고리 관리를 제공합니다.
 * 등급별(free/pro/enterprise) 메모리 생성 수량을 제한하며,
 * 소유권 검증을 통해 타 사용자 메모리 접근을 방지합니다.
 *
 * @module routes/memory.routes
 * @description
 * - GET    /api/memory             - 사용자 메모리 조회 (필터: category, limit, minImportance)
 * - POST   /api/memory             - 메모리 생성 (등급별 제한)
 * - GET    /api/memory/search      - 메모리 검색 (연관 메모리 조회)
 * - PUT    /api/memory/:id         - 메모리 수정 (소유권 확인)
 * - DELETE /api/memory/:id         - 메모리 삭제 (소유권 확인)
 * - DELETE /api/memory?confirm=true - 전체 메모리 삭제
 * - GET    /api/memory/categories  - 메모리 카테고리 목록
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires MemoryService - 장기 메모리 서비스
 */

import { Router, Request, Response } from 'express';
import { getMemoryService } from '../services/MemoryService';
import { MemoryCategory } from '../data/models/unified-database';
import { success, badRequest, notFound, forbidden } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { createMemorySchema, updateMemorySchema } from '../schemas/memory.schema';
import { createLogger } from '../utils/logger';
const router = Router();
const logger = createLogger('MemoryRoutes');

// 모든 메모리 엔드포인트에 인증 필수
router.use(requireAuth);

// ================================================
// 메모리 조회
// ================================================

/**
 * GET /api/memory
 * 사용자의 모든 메모리 조회
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
     const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) || 'anonymous';
     const category = req.query.category as MemoryCategory | undefined;
     const limit = parseInt(req.query.limit as string, 10) || 50;
     const minImportance = parseFloat(req.query.minImportance as string) || undefined;

     const memoryService = getMemoryService();
     const memories = await memoryService.getUserMemories(userId, {
         category,
         limit,
         minImportance
     });

     res.json(success({ memories, total: memories.length, userId }));
}));

// 등급별 메모리 생성 제한
const MEMORY_LIMITS: Record<string, number> = {
    free: 50,
    pro: 500,
    enterprise: Infinity
};

  /**
   * POST /api/memory
  * 메모리 생성
  */
router.post('/', validate(createMemorySchema), asyncHandler(async (req: Request, res: Response) => {
     const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) || 'anonymous';
     const { category, key, value, importance, tags } = req.body;

      if (!category || !key || !value) {
          return res.status(400).json(badRequest('category, key, value는 필수입니다.'));
      }

      // 등급별 메모리 생성 수량 제한
      const userTier = (req.user && 'tier' in req.user) ? (req.user as { tier: string }).tier : 'free';
      const userRole = req.user?.role || 'guest';
      const memoryLimit = userRole === 'admin' ? Infinity : (MEMORY_LIMITS[userTier] || MEMORY_LIMITS['free']);

      if (memoryLimit !== Infinity) {
          const memSvc = getMemoryService();
          const existing = await memSvc.getUserMemories(userId, { limit: memoryLimit + 1 });
          if (existing.length >= memoryLimit) {
              res.status(403).json(forbidden(`메모리 생성 제한 초과 (${userTier}: 최대 ${memoryLimit}개)`));
              return;
          }
      }

      const validCategories: MemoryCategory[] = ['preference', 'fact', 'project', 'relationship', 'skill', 'context'];
      if (!validCategories.includes(category)) {
          return res.status(400).json(badRequest(`category는 다음 중 하나여야 합니다: ${validCategories.join(', ')}`));
      }

     const memoryService = getMemoryService();
     const memoryId = await memoryService.saveMemory(userId, null, {
         category,
         key,
         value,
         importance: importance || 0.5,
         tags: tags || []
     });

      res.status(201).json(success({ id: memoryId, message: '메모리가 저장되었습니다.', category, key }));
}));

/**
 * GET /api/memory/search
 * 메모리 검색 (연관 메모리 조회)
 */
router.get('/search', asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) || 'anonymous';
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
        return res.status(400).json(badRequest('검색어(q)는 필수입니다'));
    }
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const db = getUnifiedDatabase();
    const memories = await db.getRelevantMemories(userId, q, limit);
    res.json(success({ memories, total: memories.length, query: q }));
}));

  /**
   * PUT /api/memory/:id
  * 메모리 수정
  */
router.put('/:id', validate(updateMemorySchema), asyncHandler(async (req: Request, res: Response) => {
     const memoryId = req.params.id;
    const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) || 'anonymous';
    const db = getUnifiedDatabase();
    // 소유권 확인
    const ownerUserId = await db.getMemoryOwner(memoryId);
    if (ownerUserId === null) {
        return res.status(404).json(notFound('메모리를 찾을 수 없습니다'));
    }
    if (String(ownerUserId) !== userId && req.user?.role !== 'admin') {
        return res.status(403).json(forbidden('접근 권한이 없습니다'));
    }
     const { value, importance } = req.body;

      if (!value && importance === undefined) {
          return res.status(400).json(badRequest('value 또는 importance 중 하나는 필수입니다.'));
      }

     const memoryService = getMemoryService();
     await memoryService.updateMemory(memoryId, { value, importance });

      res.json(success({ message: '메모리가 수정되었습니다.' }));
}));

  /**
   * DELETE /api/memory/:id
  * 메모리 삭제
  */
router.delete('/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
     const memoryId = req.params.id;
    const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) || 'anonymous';
    const db = getUnifiedDatabase();
    // 소유권 확인
    const ownerUserId = await db.getMemoryOwner(memoryId);
    if (ownerUserId === null) {
        return res.status(404).json(notFound('메모리를 찾을 수 없습니다'));
    }
    if (String(ownerUserId) !== userId && req.user?.role !== 'admin') {
        return res.status(403).json(forbidden('접근 권한이 없습니다'));
    }

     const memoryService = getMemoryService();
     await memoryService.deleteMemory(memoryId);

      res.json(success({ message: '메모리가 삭제되었습니다.' }));
}));

  /**
   * DELETE /api/memory
  * 사용자의 모든 메모리 삭제
  */
router.delete('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
     const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) || 'anonymous';
     const confirm = req.query.confirm === 'true';

      if (!confirm) {
          return res.status(400).json(badRequest('모든 메모리를 삭제하려면 ?confirm=true 파라미터가 필요합니다.'));
      }

     const memoryService = getMemoryService();
     await memoryService.clearUserMemories(userId);

      res.json(success({ message: '모든 메모리가 삭제되었습니다.' }));
}));

 // ================================================
 // 메모리 카테고리 정보
 // ================================================

/**
 * GET /api/memory/categories
 * 메모리 카테고리 목록
 */
router.get('/categories', (_req: Request, res: Response) => {
     res.json(success({
         categories: [
             { id: 'preference', name: '선호도', description: '사용자의 선호 사항 (언어, 스타일 등)', emoji: '❤️' },
             { id: 'fact', name: '사실 정보', description: '개인 정보 (이름, 직업, 위치 등)', emoji: '📋' },
             { id: 'project', name: '프로젝트', description: '진행 중인 프로젝트 정보', emoji: '🚀' },
             { id: 'relationship', name: '관계', description: '언급된 사람, 조직 정보', emoji: '👥' },
             { id: 'skill', name: '기술/역량', description: '사용자의 스킬과 전문성', emoji: '💪' },
             { id: 'context', name: '컨텍스트', description: '현재 진행 중인 작업, 목표', emoji: '🎯' }
         ]
     }));
 });

export default router;
export { router as memoryRouter };
