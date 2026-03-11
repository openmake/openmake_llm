/**
 * ============================================================
 * Cluster Routes - 클러스터 상태 및 노드 관리 API
 * ============================================================
 */

import { Request, Response, Router } from 'express';
import { ClusterManager, getClusterManager } from '../cluster/manager';
import { success } from '../utils/api-response';

interface ClusterRouterDeps {
    cluster?: ClusterManager;
}

/**
 * 클러스터 라우터 팩토리 함수
 */
export function createClusterRouter(deps: ClusterRouterDeps = {}): Router {
    const router = Router();
    const cluster = deps.cluster || getClusterManager();

    // 클러스터 전체 정보
    router.get('/', (_req: Request, res: Response) => {
        res.json(success({
            name: cluster.clusterName,
            stats: cluster.getStats(),
            nodes: cluster.getNodes()
        }));
    });

    // 클러스터 상태 (cluster.html에서 사용)
    router.get('/status', (_req: Request, res: Response) => {
        res.json(success({
            name: cluster.clusterName,
            stats: cluster.getStats(),
            nodes: cluster.getNodes()
        }));
    });

    // 노드 목록
    router.get('/nodes', (_req: Request, res: Response) => {
        res.json(success(cluster.getNodes()));
    });

    // 통계
    router.get('/stats', (_req: Request, res: Response) => {
        res.json(success(cluster.getStats()));
    });

    return router;
}
