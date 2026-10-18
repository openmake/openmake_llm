/**
 * ============================================================
 * Health Controller
 * ============================================================
 * 헬스체크 및 서비스 준비 상태 API
 */

import { Request, Response, Router } from 'express';
import { ClusterManager, getClusterManager } from '../cluster/manager';
import { getPool } from '../data/models/unified-database';
import { success } from '../utils/api-response';
import { DB_POOL_TIMEOUTS } from '../config/timeouts';
import { getBuildInfo } from '../config/build-id';
import { APP_VERSION } from '../config/constants';
import { getConfig } from '../config/env';
import { toLocalModelTag } from '../config/model-roles';

// 버전 SoT = 루트 package.json (release-please 가 bump). 여기서 재구현하지 않는다.
const _cachedVersion = APP_VERSION;

/**
 * PURE: 기본 모델(`LLM_DEFAULT_MODEL`)이 연결된 LLM 노드의 모델 목록에 있나.
 * 외부 provider 모델이면 여기서 판정하지 않고(null — 게이트웨이 목록은 로컬 모델 기준), 목록을 받지 못했어도 null.
 */
export function defaultModelListed(defaultModel: string, listed: readonly string[]): boolean | null {
    const tag = toLocalModelTag(defaultModel.trim());
    if (!tag || listed.length === 0) return null;
    return listed.includes(tag);
}

/**
 * 헬스체크 및 서비스 준비 상태 컨트롤러
 * 
 * @class HealthController
 * @description
 * - Kubernetes 헬스체크 엔드포인트 (/health)
 * - 서비스 레디니스 프로브 (/ready)
 */
class HealthController {
    /** Express 라우터 인스턴스 */
    private router: Router;
    /** LLM 클러스터 매니저 */
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
            build: getBuildInfo()
        }));
    }

    /**
     * GET /ready
     * 서비스 준비 상태 확인 — LLM 노드 연결 + DB 연결 + 기본 모델이 노드 목록에 있는지. **아무것도 쓰지 않는다**.
     * 운영(릴리스) 환경의 배포 스모크가 채팅 대신 이것으로 연결을 확인한다(scripts/env/omk.sh) — 채팅은 대화 기록·모델 호출을
     * 남기고, 코드 동작은 같은 커밋으로 staging 에서 이미 확인했다.
     */
    private async readinessCheck(req: Request, res: Response): Promise<void> {
        const stats = this.cluster.getStats();
        const clusterReady = stats.onlineNodes > 0;

        // DB 연결 확인 (2초 타임아웃)
        let dbReady = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const pool = getPool();
            const dbPing = pool.query('SELECT 1');
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('DB ping timeout')), DB_POOL_TIMEOUTS.HEALTH_PING_TIMEOUT_MS);
            });
            await Promise.race([dbPing, timeout]);
            dbReady = true;
        } catch {
            dbReady = false;
        } finally {
            if (timer) clearTimeout(timer);
        }

        // 기본 모델 이름·키 같은 설정 실수는 노드가 떠 있어도 채팅을 막는다 — 목록에 없다고 확인될 때만 준비 안 됨으로 본다
        const defaultModel = getConfig().llmDefaultModel;
        const modelListed = defaultModelListed(defaultModel, stats.uniqueModels);
        const isReady = clusterReady && dbReady && modelListed !== false;

        res.status(isReady ? 200 : 503).json(success({
            ready: isReady,
            onlineNodes: stats.onlineNodes,
            totalNodes: stats.totalNodes,
            dbConnected: dbReady,
            defaultModel: { id: defaultModel, listed: modelListed },
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
