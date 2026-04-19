/**
 * ============================================================
 * Model Health Monitor - Cloud 모델 가용성 모니터링 서비스
 * ============================================================
 *
 * Ollama Cloud 모델 × API Key 매트릭스의 가용성을 주기적으로 점검하고
 * 결과 스냅샷을 메모리에 유지하여 다음 두 용도로 사용합니다:
 *
 * 1. **라우팅 서킷 브레이커**: model-selector가 장애 모델을 회피
 * 2. **관찰성**: Admin UI/REST API에서 현재 상태 조회
 *
 * 단일 진실 소스(SSOT) 역할을 하므로 routes/model.routes.ts,
 * schedulers, model-selector가 모두 이 서비스를 참조합니다.
 *
 * @module services/model-health-monitor
 */

import axios from 'axios';
import { createLogger } from '../utils/logger';
import { OLLAMA_CLOUD_HOST } from '../config/constants';
import { getApiKeyManager } from '../ollama/api-key-manager';
import {
    ENGINE_FALLBACKS,
    AUTO_ROUTING_ENGINE_MAP,
    GV_MODEL_MAP,
    GV_DEFAULT_MODELS,
} from '../config/model-defaults';
import { getAlertSystem } from '../monitoring/alerts';

const logger = createLogger('ModelHealthMonitor');

/** 개별 ping 결과 */
export interface ModelHealthResult {
    model: string;
    keyIndex: number;
    ok: boolean;
    httpStatus: number;
    latencyMs: number;
    error?: string;
}

/** 모델별 요약 */
export interface ModelHealthSummary {
    model: string;
    healthy: boolean;
    okCount: number;
    totalCount: number;
    avgLatencyMs: number;
    errors: Array<{ keyIndex: number; httpStatus: number; error?: string }>;
}

/** 스냅샷 */
export interface HealthSnapshot {
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

/** 헬스체크 ping용 최소 페이로드 */
const HEALTH_PING_PAYLOAD = {
    messages: [{ role: 'user', content: 'ping' }],
    stream: false,
    options: { num_predict: 1 },
} as const;

/** 기본 요청 타임아웃 (ms) */
const DEFAULT_PING_TIMEOUT_MS = 30_000;

/** 최대 허용 타임아웃 (ms) */
const MAX_PING_TIMEOUT_MS = 60_000;

/**
 * 설정된 모든 라우팅 맵에서 고유한 :cloud 모델 식별자를 수집합니다.
 *
 * 출처:
 * - ENGINE_FALLBACKS (6개 엔진 폴백)
 * - AUTO_ROUTING_ENGINE_MAP (14 QueryType × 3 Tier)
 * - GV_MODEL_MAP (generator/verifier 쌍)
 * - GV_DEFAULT_MODELS (기본 폴백)
 */
export function collectConfiguredCloudModels(): string[] {
    const set = new Set<string>();
    for (const model of Object.values(ENGINE_FALLBACKS)) set.add(model);
    for (const tierMap of Object.values(AUTO_ROUTING_ENGINE_MAP)) {
        for (const model of Object.values(tierMap)) set.add(model);
    }
    for (const gv of Object.values(GV_MODEL_MAP)) {
        set.add(gv.generator);
        set.add(gv.verifier);
    }
    set.add(GV_DEFAULT_MODELS.generator);
    set.add(GV_DEFAULT_MODELS.verifier);

    return Array.from(set)
        .filter((m) => {
            const lower = m.toLowerCase();
            return lower.endsWith(':cloud') || lower.endsWith('-cloud');
        })
        .sort();
}

/**
 * 단일 모델 × 단일 키 ping
 */
export async function pingModelOnce(
    model: string,
    keyIndex: number,
    authHeaders: Record<string, string>,
    timeoutMs: number = DEFAULT_PING_TIMEOUT_MS,
): Promise<ModelHealthResult> {
    const started = Date.now();
    try {
        const res = await axios.post(
            `${OLLAMA_CLOUD_HOST}/api/chat`,
            { model, ...HEALTH_PING_PAYLOAD },
            {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                timeout: timeoutMs,
            },
        );
        return {
            model,
            keyIndex,
            ok: res.status >= 200 && res.status < 300,
            httpStatus: res.status,
            latencyMs: Date.now() - started,
        };
    } catch (err: unknown) {
        const latencyMs = Date.now() - started;
        if (axios.isAxiosError(err)) {
            return {
                model,
                keyIndex,
                ok: false,
                httpStatus: err.response?.status ?? 0,
                latencyMs,
                error: err.message,
            };
        }
        return {
            model,
            keyIndex,
            ok: false,
            httpStatus: 0,
            latencyMs,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * Model Health Monitor 싱글톤.
 *
 * - `runCheck()`: 라이브 체크 실행 + 스냅샷 갱신 + 알림 발송
 * - `getSnapshot()`: 캐시된 최신 스냅샷 반환 (없으면 null)
 * - `isModelHealthy(model)`: 서킷 브레이커 질의
 * - `getUnhealthyModels()`: 현재 장애 모델 목록
 */
export class ModelHealthMonitor {
    private snapshot: HealthSnapshot | null = null;
    private inFlight = new Map<string, Promise<HealthSnapshot>>();

    /**
     * 헬스체크를 실행합니다. 동일 옵션 조합의 체크가 이미 진행 중이면
     * 기존 Promise를 재사용해 중복 호출을 방지합니다.
     *
     * bug_002: 이전 구현은 단일 슬롯 inFlight라 옵션이 다른 caller가
     *          먼저 진행 중인 다른 스냅샷을 받아가는 문제가 있었다.
     *          (예: scheduler의 {full:false} 중 admin의 {full:true}가 single-key
     *           스냅샷을 "전체 키 매트릭스"인 양 받음)
     *
     * @param options.full  true=모든 키 × 모든 모델, false=현재 활성 키 1개
     * @param options.model 특정 모델만 체크
     * @param options.timeoutMs 개별 요청 타임아웃
     */
    async runCheck(options: {
        full?: boolean;
        model?: string;
        timeoutMs?: number;
    } = {}): Promise<HealthSnapshot> {
        const key = JSON.stringify({
            full: !!options.full,
            model: options.model ?? null,
            timeoutMs: options.timeoutMs ?? null,
        });
        const existing = this.inFlight.get(key);
        if (existing) {
            return existing;
        }

        const promise = this.doCheck(options).finally(() => {
            if (this.inFlight.get(key) === promise) {
                this.inFlight.delete(key);
            }
        });
        this.inFlight.set(key, promise);
        return promise;
    }

    private async doCheck(options: {
        full?: boolean;
        model?: string;
        timeoutMs?: number;
    }): Promise<HealthSnapshot> {
        const { full = false, model: modelFilter } = options;
        const timeoutMs = Math.min(
            Math.max(options.timeoutMs ?? DEFAULT_PING_TIMEOUT_MS, 1000),
            MAX_PING_TIMEOUT_MS,
        );

        const manager = getApiKeyManager();
        if (!manager.hasValidKey()) {
            throw new Error('API Key Pool에 유효한 키가 없습니다.');
        }

        const allModels = collectConfiguredCloudModels();
        const targets = modelFilter ? allModels.filter((m) => m === modelFilter) : allModels;
        if (targets.length === 0) {
            throw new Error(`대상 모델이 없습니다 (filter=${modelFilter ?? 'none'}).`);
        }

        const totalKeys = manager.getTotalKeys();
        const keyIndices = full
            ? Array.from({ length: totalKeys }, (_, i) => i)
            : [manager.getCurrentKeyIndex()];

        logger.info(
            `헬스체크 시작: ${targets.length} 모델 × ${keyIndices.length} 키 = ${targets.length * keyIndices.length} 호출 (timeout=${timeoutMs}ms)`,
        );

        const startedAt = Date.now();
        const results: ModelHealthResult[] = [];

        for (const model of targets) {
            const pings = keyIndices.map((idx) => {
                const headers = manager.getAuthHeadersForIndex(idx);
                return pingModelOnce(model, idx, headers, timeoutMs);
            });
            const modelResults = await Promise.all(pings);
            results.push(...modelResults);
        }

        const totalDurationMs = Date.now() - startedAt;

        const summary: ModelHealthSummary[] = targets.map((model) => {
            const modelResults = results.filter((r) => r.model === model);
            const okCount = modelResults.filter((r) => r.ok).length;
            const avgLatency =
                modelResults.length > 0
                    ? Math.round(
                          modelResults.reduce((s, r) => s + r.latencyMs, 0) / modelResults.length,
                      )
                    : 0;
            return {
                model,
                healthy: okCount === modelResults.length && okCount > 0,
                okCount,
                totalCount: modelResults.length,
                avgLatencyMs: avgLatency,
                errors: modelResults
                    .filter((r) => !r.ok)
                    .map((r) => ({ keyIndex: r.keyIndex, httpStatus: r.httpStatus, error: r.error })),
            };
        });

        const unhealthyCount = summary.filter((s) => !s.healthy).length;
        const healthyCount = targets.length - unhealthyCount;

        logger.info(
            `헬스체크 완료: ${healthyCount}/${targets.length} 정상, ${totalDurationMs}ms 소요`,
        );

        const snapshot: HealthSnapshot = {
            checkedAt: new Date().toISOString(),
            totalDurationMs,
            mode: full ? 'full-matrix' : 'single-key',
            keyCount: keyIndices.length,
            totalKeys,
            modelCount: targets.length,
            healthyCount,
            unhealthyCount,
            summary,
            raw: results,
        };

        // 부분 필터 체크가 아닐 때만 전역 스냅샷을 갱신
        if (!modelFilter) {
            this.snapshot = snapshot;

            // 불건전 모델이 있으면 알림 발송 (쿨다운은 AlertSystem이 처리)
            if (unhealthyCount > 0) {
                try {
                    const unhealthy = summary.filter((s) => !s.healthy);
                    await getAlertSystem().sendAlert(
                        'api_error',
                        unhealthyCount >= 3 ? 'critical' : 'warning',
                        `Cloud 모델 ${unhealthyCount}개 장애 감지`,
                        `헬스체크에서 ${unhealthyCount}/${targets.length} 모델이 비정상 응답했습니다.`,
                        {
                            unhealthyModels: unhealthy.map((u) => ({
                                model: u.model,
                                okCount: u.okCount,
                                totalCount: u.totalCount,
                                errors: u.errors.slice(0, 3),
                            })),
                            mode: snapshot.mode,
                            checkedAt: snapshot.checkedAt,
                        },
                    );
                } catch (err) {
                    logger.warn('헬스체크 알림 발송 실패:', err);
                }
            }
        }

        return snapshot;
    }

    /** 최신 스냅샷 반환 (아직 실행된 적 없으면 null) */
    getSnapshot(): HealthSnapshot | null {
        return this.snapshot;
    }

    /**
     * 서킷 브레이커 질의. 스냅샷이 없으면 "모름=건전"으로 간주해 true 반환
     * (모니터가 부팅 직후인 경우 라우팅 차단을 피함).
     */
    isModelHealthy(model: string): boolean {
        if (!this.snapshot) return true;
        const found = this.snapshot.summary.find((s) => s.model === model);
        if (!found) return true; // 스냅샷에 없는 모델은 제어 대상 아님
        return found.healthy;
    }

    /** 현재 장애 모델 목록 반환 */
    getUnhealthyModels(): string[] {
        if (!this.snapshot) return [];
        return this.snapshot.summary.filter((s) => !s.healthy).map((s) => s.model);
    }
}

/** 싱글톤 인스턴스 */
let instance: ModelHealthMonitor | null = null;

export function getModelHealthMonitor(): ModelHealthMonitor {
    if (!instance) {
        instance = new ModelHealthMonitor();
    }
    return instance;
}

/**
 * 서킷 브레이커: 주어진 모델이 건전하면 그대로, 아니면 안정 폴백으로 대체합니다.
 *
 * 우선순위:
 *  1. 요청 모델이 건전하면 그대로 반환
 *  2. 건전한 fallbackCandidates 중 첫 번째
 *  3. 최종 안전장치 `ENGINE_FALLBACKS.FAST` (gemini-3-flash-preview:cloud — 검증된 최저 장애 모델)
 *
 * 스냅샷이 없거나(부팅 직후) 모델이 스냅샷에 등록되지 않았으면 원본 유지.
 *
 * @param requested 라우팅이 선택한 모델
 * @param fallbackCandidates 요청 모델이 건전하지 않을 때 시도할 후보 목록
 * @returns 실제로 사용할 모델명
 */
export function applyHealthCircuitBreaker(
    requested: string,
    fallbackCandidates: string[] = [],
): string {
    const monitor = getModelHealthMonitor();

    if (monitor.isModelHealthy(requested)) {
        return requested;
    }

    // 요청 모델이 장애 상태 — 후보 순회
    for (const candidate of fallbackCandidates) {
        if (candidate !== requested && monitor.isModelHealthy(candidate)) {
            logger.warn(
                `[CircuitBreaker] ${requested} unhealthy → ${candidate} (후보 목록에서 선택)`,
            );
            return candidate;
        }
    }

    // 최종 안전장치
    const safeFallback = ENGINE_FALLBACKS.FAST;
    if (safeFallback !== requested && monitor.isModelHealthy(safeFallback)) {
        logger.warn(
            `[CircuitBreaker] ${requested} unhealthy, 후보 모두 실패 → 안전장치 ${safeFallback}`,
        );
        return safeFallback;
    }

    // 안전장치마저 장애면 원본 반환 (호출 측에서 에러 처리)
    logger.error(
        `[CircuitBreaker] ${requested} + 안전장치 ${safeFallback} 모두 장애 상태 — 원본 유지`,
    );
    return requested;
}
