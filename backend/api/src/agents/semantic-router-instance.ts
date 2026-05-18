/**
 * ============================================================
 * Semantic Router Instance — 프로세스 단일 인스턴스 + 백그라운드 초기화
 * ============================================================
 *
 * SemanticAgentRouter PoC를 시스템 전역에서 사용 가능하게 하는 singleton 래퍼.
 *
 * 설계 원칙(Gemini 검토 반영):
 * - 백그라운드 초기화: 서버 부팅 후 비동기로 100명 임베딩 실행, cold-start 영향 X
 * - fire-and-forget shadow 호출: agent-resolver는 결과를 await 하지 않음
 * - 인덱스 미준비 시 자동 스킵 (isIndexReady=false)
 * - 샘플링 비율로 운영 비용 제어 (기본 100% — 데이터 수집 단계)
 *
 * @module agents/semantic-router-instance
 */
import { createLogger } from '../utils/logger';
import { SemanticAgentRouter, type EmbedFunction, type AgentCandidate } from './semantic-router';
import { DEFAULT_SEMANTIC_CACHE_PATH } from './semantic-cache';
import { industryData } from './agent-data';
import { getModelForRole } from '../config/model-roles';
import type { LLMClient } from '../llm';

const logger = createLogger('SemanticRouterInstance');

const SEMANTIC_ROUTER_ENABLED =
    (process.env.OMK_SEMANTIC_ROUTER_ENABLED ?? 'false') === 'true';

const SEMANTIC_ROUTER_SAMPLE_RATE =
    Math.max(0, Math.min(1, Number(process.env.OMK_SEMANTIC_ROUTER_SAMPLE_RATE ?? '1.0')));

const SEMANTIC_DISK_CACHE_ENABLED =
    (process.env.OMK_SEMANTIC_DISK_CACHE_ENABLED ?? 'true') === 'true';

const SEMANTIC_EMBEDDING_MODEL = getModelForRole('embedding');

let routerInstance: SemanticAgentRouter | null = null;
let initPromise: Promise<void> | null = null;
let initFailed = false;

/**
 * 프로세스 전역 singleton 라우터 반환 (없으면 생성).
 * 인덱스는 별도로 initSemanticRouter()를 호출해야 채워짐.
 */
function getOrCreateRouter(embed: EmbedFunction): SemanticAgentRouter {
    if (!routerInstance) {
        routerInstance = new SemanticAgentRouter(embed, {
            diskCachePath: SEMANTIC_DISK_CACHE_ENABLED ? DEFAULT_SEMANTIC_CACHE_PATH : undefined,
            embeddingModel: SEMANTIC_EMBEDDING_MODEL,
        });
    }
    return routerInstance;
}

/**
 * 서버 부팅 후 백그라운드에서 호출. 100명 에이전트 임베딩을 채운다.
 * 실패해도 메인 흐름에 영향 없음 (shadow 호출이 자동 스킵됨).
 *
 * @param client LLMClient (embed 호출용)
 */
export function initSemanticRouter(client: LLMClient): void {
    if (!SEMANTIC_ROUTER_ENABLED) {
        logger.info('Semantic Router 비활성 (OMK_SEMANTIC_ROUTER_ENABLED=false)');
        return;
    }
    if (initPromise) {
        logger.debug('Semantic Router 초기화 이미 진행 중');
        return;
    }

    const embed: EmbedFunction = (text) => client.embed(text);
    const router = getOrCreateRouter(embed);

    // 산업 데이터에서 카테고리별 에이전트 묶음 생성
    const indexInput = Object.entries(industryData).map(([categoryId, category]) => ({
        categoryName: categoryId,
        agents: category.agents,
    }));

    initPromise = router.initializeIndex(indexInput)
        .then(() => {
            const stats = router.getStatistics();
            logger.info(
                `Semantic Router 백그라운드 초기화 완료: ${stats.indexedAgentCount}명 / ` +
                `${stats.indexBuildDurationMs}ms`
            );
        })
        .catch((err) => {
            initFailed = true;
            logger.error('Semantic Router 초기화 실패 (shadow 호출은 자동 스킵):', err);
        });
}

/**
 * 인덱스가 준비된 경우에만 keyword vs semantic 비교를 수행하고 결과를 로그로 남긴다.
 * 절대 await 하지 않아도 됨 — 메인 흐름 영향 없음.
 *
 * 환경변수 OMK_SEMANTIC_ROUTER_SAMPLE_RATE로 일정 비율만 비교 가능 (운영 비용 제어).
 */
export async function shadowCompare(
    message: string,
    keywordAgentId: string,
    keywordConfidence: number
): Promise<void> {
    if (!SEMANTIC_ROUTER_ENABLED || initFailed || !routerInstance) {
        return;
    }
    if (!routerInstance.isIndexReady()) {
        return;
    }
    if (Math.random() > SEMANTIC_ROUTER_SAMPLE_RATE) {
        return;
    }

    try {
        const result = await routerInstance.compareWithKeywordResult(message, keywordAgentId, 3);
        const topId = result.topCandidates[0]?.agentId ?? 'none';
        const topSim = result.topSimilarity.toFixed(3);
        const matchTag = topId === keywordAgentId ? 'top1-match' : 'top1-divergent';
        logger.info(
            `[shadow] kw=${keywordAgentId}(conf=${keywordConfidence.toFixed(2)}) ` +
            `sem-top1=${topId}(sim=${topSim}) ` +
            `kwInTop3=${result.keywordInTopK} kwRank=${result.keywordRank} ${matchTag}`
        );
    } catch (err) {
        // 절대 메인 흐름에 영향을 주지 않는다 — shadow 실패는 단순 경고
        logger.warn('Semantic shadow 비교 실패 (라우팅 결정 영향 없음):', err);
    }
}

/**
 * 테스트용 — singleton 상태 초기화
 */
export function _resetForTests(): void {
    routerInstance = null;
    initPromise = null;
    initFailed = false;
}

/**
 * 인덱스 준비 여부 (서버 health check 등에서 사용 가능)
 */
export function isSemanticRouterReady(): boolean {
    return !!routerInstance && routerInstance.isIndexReady();
}

/**
 * 현재 라우터 통계 (관측성/메트릭용)
 */
export function getSemanticRouterStatistics(): ReturnType<SemanticAgentRouter['getStatistics']> | null {
    return routerInstance?.getStatistics() ?? null;
}

/**
 * 직접 후보 조회 (향후 본격 통합 시 사용)
 */
export async function findSemanticCandidates(message: string, topK = 3): Promise<AgentCandidate[]> {
    if (!routerInstance || !routerInstance.isIndexReady()) {
        return [];
    }
    return routerInstance.findCandidates(message, topK);
}
