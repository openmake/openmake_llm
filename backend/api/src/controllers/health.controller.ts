/**
 * ============================================================
 * Health Controller
 * ============================================================
 * 헬스체크 및 서비스 준비 상태 API
 */

import { Request, Response, Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ClusterManager, getClusterManager } from '../cluster/manager';
import { success } from '../utils/api-response';

// package.json에서 버전을 한 번만 읽어 캐시
const pkgJsonPath = path.resolve(__dirname, '../../package.json');
let _cachedVersion = '1.0.0';
try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    _cachedVersion = pkg.version || '1.0.0';
} catch { /* fallback */ }

// 빌드 정보 파일 (deploy 시 자동 생성됨)
const buildInfoPath = path.resolve(__dirname, '../build-info.json');
let _buildInfo: { buildTime: string; gitHash: string; gitDate: string } = {
    buildTime: new Date().toISOString(),
    gitHash: 'unknown',
    gitDate: 'unknown'
};
try {
    if (fs.existsSync(buildInfoPath)) {
        _buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8'));
    }
} catch { /* fallback */ }

/**
 * 헬스체크 및 서비스 준비 상태 컨트롤러
 * 
 * @class HealthController
 * @description
 * - Kubernetes 헬스체크 엔드포인트 (/health)
 * - 서비스 레디니스 프로브 (/ready)
 */
export class HealthController {
    /** Express 라우터 인스턴스 */
    private router: Router;
    /** Ollama 클러스터 매니저 */
    private cluster: ClusterManager;

    /**
     * HealthController 인스턴스를 생성합니다.
     * @param cluster - ClusterManager 인스턴스 (선택적, 기본값: 싱글톤)
     */
    constructor(cluster?: ClusterManager) {
        this.router = Router();
        this.cluster = cluster || getClusterManager();
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.get('/health', this.healthCheck.bind(this));
        this.router.get('/ready', this.readinessCheck.bind(this));
    }

    /**
     * GET /health
     * 기본 헬스체크 
     */
    private healthCheck(req: Request, res: Response): void {
        const stats = this.cluster.getStats();
        res.json(success({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: _cachedVersion,
            nodeVersion: process.version,
            cluster: {
                onlineNodes: stats.onlineNodes,
                totalNodes: stats.totalNodes,
                totalModels: stats.totalModels
            },
            build: _buildInfo
        }));
    }

    /**
     * GET /ready
     * 서비스 준비 상태 확인
     */
    private async readinessCheck(req: Request, res: Response): Promise<void> {
        const stats = this.cluster.getStats();
        const isReady = stats.onlineNodes > 0;

        res.status(isReady ? 200 : 503).json(success({
            ready: isReady,
            onlineNodes: stats.onlineNodes,
            totalNodes: stats.totalNodes,
            timestamp: new Date().toISOString()
        }));
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
 * HealthController 인스턴스를 생성하는 팩토리 함수
 * 
 * @param cluster - ClusterManager 인스턴스 (선택적)
 * @returns 설정된 Express Router
 */
export function createHealthController(cluster?: ClusterManager): Router {
    return new HealthController(cluster).getRouter();
}
