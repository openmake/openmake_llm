/**
 * ============================================================
 * Nodes Routes - 클러스터 노드 관리 API 라우트
 * ============================================================
 *
 * Ollama 클러스터의 노드 추가 및 제거를 담당합니다.
 * 모든 엔드포인트는 관리자(admin) 전용입니다.
 *
 * @module routes/nodes.routes
 * @description
 * - POST   /api/nodes          - 클러스터 노드 추가 (host, port, name)
 * - DELETE /api/nodes/:nodeId  - 클러스터 노드 제거
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires requireAdmin - 관리자 권한 미들웨어
 * @requires ClusterManager - Ollama 클러스터 관리
 */

import { Router, Request, Response } from 'express';
import { ClusterManager } from '../cluster/manager';
import { success, internalError } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth, requireAdmin } from '../auth';
import { validate } from '../middlewares/validation';
import { addClusterNodeSchema } from '../schemas/nodes.schema';
import { createLogger } from '../utils/logger';

const router = Router();
const logger = createLogger('NodesRoutes');

// 클러스터 노드 관리는 관리자 전용
router.use(requireAuth, requireAdmin);

let clusterRef: ClusterManager;

/**
 * 클러스터 매니저 참조 설정
 */
export function setClusterManager(cluster: ClusterManager): void {
    clusterRef = cluster;
}

/**
 * 노드 추가
 * POST /api/nodes
 */
router.post('/', validate(addClusterNodeSchema), asyncHandler(async (req: Request, res: Response) => {
    const { host, port, name } = req.body as { host: string; port: number; name?: string };

     const node = await clusterRef.addNode(host, port, name);
     if (node) {
         res.json(success(node));
     } else {
         res.status(500).json(internalError('노드 추가 실패'));
     }
}));

/**
 * 노드 제거
 * DELETE /api/nodes/:nodeId
 */
router.delete('/:nodeId', asyncHandler(async (req: Request, res: Response) => {
     const { nodeId } = req.params;
     const deleted = clusterRef.removeNode(decodeURIComponent(nodeId));
     res.json(success({ deleted }));
 }));

export default router;
