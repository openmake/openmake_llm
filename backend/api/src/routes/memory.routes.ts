/**
 * 🧠 메모리 API 라우트
 * 장기 메모리 시스템 CRUD API
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { getMemoryService } from '../services/MemoryService';
import { MemoryCategory } from '../data/models/unified-database';
import { success, badRequest, internalError } from '../utils/api-response';

const logger = createLogger('MemoryRoutes');
const router = Router();

// ================================================
// 메모리 조회
// ================================================

/**
 * GET /api/memory
 * 사용자의 모든 메모리 조회
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) || 'anonymous';
        const category = req.query.category as MemoryCategory | undefined;
        const limit = parseInt(req.query.limit as string) || 50;
        const minImportance = parseFloat(req.query.minImportance as string) || undefined;

        const memoryService = getMemoryService();
        const memories = await memoryService.getUserMemories(userId, {
            category,
            limit,
            minImportance
        });

        res.json(success({ memories, total: memories.length, userId }));
     } catch (error) {
         logger.error('메모리 컨텍스트 조회 실패:', error);
         res.status(500).json(internalError('메모리 컨텍스트 조회 실패'));
     }
 });

 /**
  * POST /api/memory
 * 메모리 생성
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) || 'anonymous';
        const { category, key, value, importance, tags } = req.body;

         if (!category || !key || !value) {
             return res.status(400).json(badRequest('category, key, value는 필수입니다.'));
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
     } catch (error) {
         logger.error('메모리 생성 실패:', error);
         res.status(500).json(internalError('메모리 생성 실패'));
     }
 });

 /**
  * PUT /api/memory/:id
 * 메모리 수정
 */
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const memoryId = req.params.id;
        const { value, importance } = req.body;

         if (!value && importance === undefined) {
             return res.status(400).json(badRequest('value 또는 importance 중 하나는 필수입니다.'));
         }

        const memoryService = getMemoryService();
        await memoryService.updateMemory(memoryId, { value, importance });

         res.json(success({ message: '메모리가 수정되었습니다.' }));
     } catch (error) {
         logger.error('메모리 수정 실패:', error);
         res.status(500).json(internalError('메모리 수정 실패'));
     }
 });

 /**
  * DELETE /api/memory/:id
 * 메모리 삭제
 */
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const memoryId = req.params.id;

        const memoryService = getMemoryService();
        await memoryService.deleteMemory(memoryId);

         res.json(success({ message: '메모리가 삭제되었습니다.' }));
     } catch (error) {
         logger.error('메모리 삭제 실패:', error);
         res.status(500).json(internalError('메모리 삭제 실패'));
     }
 });

 /**
  * DELETE /api/memory
 * 사용자의 모든 메모리 삭제
 */
router.delete('/', async (req: Request, res: Response) => {
    try {
        const userId = (req.user && 'userId' in req.user ? req.user.userId : req.user?.id?.toString()) || 'anonymous';
        const confirm = req.query.confirm === 'true';

         if (!confirm) {
             return res.status(400).json(badRequest('모든 메모리를 삭제하려면 ?confirm=true 파라미터가 필요합니다.'));
         }

        const memoryService = getMemoryService();
        await memoryService.clearUserMemories(userId);

         res.json(success({ message: '모든 메모리가 삭제되었습니다.' }));
     } catch (error) {
         logger.error('전체 메모리 삭제 실패:', error);
         res.status(500).json(internalError('전체 메모리 삭제 실패'));
     }
 });

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
