/**
 * ============================================================
 * Cluster Controller
 * ============================================================
 * 클러스터 상태 및 노드 관리 API
 */

import { Request, Response, Router } from 'express';
import { ClusterManager, getClusterManager } from '../cluster/manager';
import { requireAuth, requireAdmin } from '../auth';
import { success } from '../utils/api-response';

/**
 * LLM 클러스터 상태 및 노드 관리 컨트롤러
 * 
 * @class ClusterController
 * @description
 * - 클러스터 전체 정보 조회
 * - 노드 목록 및 상태 확인
 * - 클러스터 통계 제공
 */
export class ClusterController {
    /** Express 라우터 인스턴스 */
    private router: Router;
    /** LLM 클러스터 매니저 */
    private cluster: ClusterManager;

    /**
     * ClusterController 인스턴스를 생성합니다.
     * @param cluster - ClusterManager 인스턴스 (선택적, 기본값: 싱글톤)
     */
    constructor(cluster?: ClusterManager) {
        this.router = Router();
        this.cluster = cluster || getClusterManager();
        this.setupRoutes();
    }

    private setupRoutes(): void {
        // 🔒 내부 노드 토폴로지(host:port)·모델 카탈로그를 노출하므로 admin 전용으로 게이트한다.
        //   /api/nodes 와 동일 정책. (구 cluster.html 전용이었고 현재 프론트는 미사용)
        this.router.use(requireAuth, requireAdmin);

        // 클러스터 전체 정보
        this.router.get('/', this.getClusterInfo.bind(this));

        // 클러스터 상태 (cluster.html에서 사용)
        this.router.get('/status', this.getClusterStatus.bind(this));

        // 노드 목록
        this.router.get('/nodes', this.getNodes.bind(this));

        // 통계
        this.router.get('/stats', this.getStats.bind(this));
    }

    /**
     * GET /api/cluster
     * 클러스터 전체 정보 조회
     */
    private getClusterInfo(req: Request, res: Response): void {
        res.json(success({
            name: this.cluster.clusterName,
            stats: this.cluster.getStats(),
            nodes: this.cluster.getNodes()
        }));
    }

    /**
     * GET /api/cluster/status
     * 클러스터 상태 조회
     */
    private getClusterStatus(req: Request, res: Response): void {
        res.json(success({
            name: this.cluster.clusterName,
            stats: this.cluster.getStats(),
            nodes: this.cluster.getNodes()
        }));
    }

    /**
     * GET /api/cluster/nodes
     * 노드 목록 조회
     */
    private getNodes(req: Request, res: Response): void {
        res.json(success(this.cluster.getNodes()));
    }

    /**
     * GET /api/cluster/stats
     * 클러스터 통계 조회
     */
    private getStats(req: Request, res: Response): void {
        res.json(success(this.cluster.getStats()));
    }

    /**
     * Express 라우터를 반환합니다.
     * @returns 설정된 Router 인스턴스
     */
    getRouter(): Router {
        return this.router;
    }
}

/**
 * ClusterController 인스턴스를 생성하는 팩토리 함수
 * 
 * @param cluster - ClusterManager 인스턴스 (선택적)
 * @returns 설정된 Express Router
 */
export function createClusterController(cluster?: ClusterManager): Router {
    return new ClusterController(cluster).getRouter();
}
