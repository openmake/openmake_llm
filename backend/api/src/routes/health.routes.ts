/**
 * ============================================================
 * Health Routes - 헬스체크 및 서비스 준비 상태 API
 * ============================================================
 */

import { Request, Response, Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ClusterManager, getClusterManager } from '../cluster/manager';
import { getPool } from '../data/models/unified-database';
import { success } from '../utils/api-response';
import { DB_POOL_TIMEOUTS } from '../config/timeouts';

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

interface HealthRouterDeps {
    cluster?: ClusterManager;
}

/**
 * 헬스체크 라우터 팩토리 함수
 */
export function createHealthRouter(deps: HealthRouterDeps = {}): Router {
    const router = Router();
    const cluster = deps.cluster || getClusterManager();

    router.get('/health', (_req: Request, res: Response) => {
        const stats = cluster.getStats();
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
    });

    router.get('/ready', async (_req: Request, res: Response) => {
        const stats = cluster.getStats();
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

        const isReady = clusterReady && dbReady;

        res.status(isReady ? 200 : 503).json(success({
            ready: isReady,
            onlineNodes: stats.onlineNodes,
            totalNodes: stats.totalNodes,
            dbConnected: dbReady,
            timestamp: new Date().toISOString()
        }));
    });

    return router;
}
