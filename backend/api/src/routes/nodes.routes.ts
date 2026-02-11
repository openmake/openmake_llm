/**
 * Nodes Routes
 * 클러스터 노드 관리 라우트 모듈
 * 
 * @module routes/nodes
 */

import { Router, Request, Response } from 'express';
import { ClusterManager } from '../cluster/manager';
import { success as apiSuccess, badRequest, internalError } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';

const router = Router();

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
router.post('/', asyncHandler(async (req: Request, res: Response) => {
    const { host, port, name } = req.body;

     if (!host || !port) {
         res.status(400).json(badRequest('host와 port가 필요합니다'));
         return;
     }

     const node = await clusterRef.addNode(host, port, name);
     if (node) {
         res.json(apiSuccess(node));
     } else {
         res.status(500).json(internalError('노드 추가 실패'));
     }
}));

/**
 * 노드 제거
 * DELETE /api/nodes/:nodeId
 */
router.delete('/:nodeId', (req: Request, res: Response) => {
     const { nodeId } = req.params;
     const deleted = clusterRef.removeNode(decodeURIComponent(nodeId));
     res.json(apiSuccess({ deleted }));
 });

export default router;
