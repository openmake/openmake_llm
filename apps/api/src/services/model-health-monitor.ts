/**
 * Model Health Monitor - 로컬 모델 전환 후 스텁
 *
 * Cloud 모델 헬스체크는 단일 로컬 모델(gemma4:e4b) 환경에서 불필요합니다.
 * 로컬 모델은 항상 건전한 것으로 간주합니다.
 *
 * @module services/model-health-monitor
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('ModelHealthMonitor');

/** 개별 ping 결과 */
interface ModelHealthResult {
    model: string;
    keyIndex: number;
    ok: boolean;
    httpStatus: number;
    latencyMs: number;
    error?: string;
}

/** 모델별 요약 */
interface ModelHealthSummary {
    model: string;
    healthy: boolean;
    okCount: number;
    totalCount: number;
    avgLatencyMs: number;
    errors: Array<{ keyIndex: number; httpStatus: number; error?: string }>;
}

/** 스냅샷 */
interface HealthSnapshot {
    checkedAt: string;
    totalDurationMs: number;
    mode: 'single-key' | 'full-matrix';
    keyCount: number;
    totalKeys: number;
    modelCount: number;
    healthyCount: number;
    unhealthyCount: number;
    summary: ModelHealthSummary[];
    raw: ModelHealthResult[];
}

class ModelHealthMonitor {
    getSnapshot(): HealthSnapshot | null {
        return null;
    }

    async runCheck(_options: { full?: boolean; model?: string; timeoutMs?: number } = {}): Promise<HealthSnapshot> {
        logger.debug('로컬 모델 환경 — 헬스체크 스킵');
        return {
            checkedAt: new Date().toISOString(),
            totalDurationMs: 0,
            mode: 'single-key',
            keyCount: 0,
            totalKeys: 0,
            modelCount: 0,
            healthyCount: 0,
            unhealthyCount: 0,
            summary: [],
            raw: [],
        };
    }

    isModelHealthy(_model: string): boolean {
        return true;
    }

    getUnhealthyModels(): string[] {
        return [];
    }
}

let instance: ModelHealthMonitor | null = null;

export function getModelHealthMonitor(): ModelHealthMonitor {
    if (!instance) {
        instance = new ModelHealthMonitor();
    }
    return instance;
}

