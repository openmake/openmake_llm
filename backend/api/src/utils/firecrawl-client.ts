/**
 * ============================================================
 * Firecrawl HTTP Client - 공유 HTTP 헬퍼
 * ============================================================
 *
 * MCP firecrawl 도구와 DeepResearchService 양쪽에서 사용하는
 * 공통 Firecrawl API 호출 헬퍼입니다.
 *
 * 서킷 브레이커 패턴으로 인증/크레딧 소진(401/402/403) 연속 실패 시
 * HTTP 요청 없이 즉시 차단합니다.
 *
 * @module utils/firecrawl-client
 * @see mcp/firecrawl.ts - MCP 도구 핸들러 (이 헬퍼 사용)
 * @see services/DeepResearchService.ts - 심층 연구 스크래핑 (이 헬퍼 사용)
 */

import { createLogger } from './logger';
import { validateOutboundUrl } from '../security/ssrf-guard';
import { errorMessage } from './error-message';

const logger = createLogger('FirecrawlClient');

// ============================================
// Circuit Breaker — 연속 인증/크레딧 실패 차단
// ============================================

/** 서킷 브레이커 트립 기준 연속 실패 횟수 */
const CIRCUIT_BREAKER_THRESHOLD = 3;

/** 서킷 브레이커 자동 리셋 시간 (ms) — 5분 */
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000;

/** 서킷 브레이커를 트립시키는 HTTP 상태 코드 (인증/크레딧 관련) */
const CIRCUIT_BREAKER_CODES = new Set([401, 402, 403]);

/** 서킷 브레이커 내부 상태 */
const circuitState = {
    isOpen: false,
    consecutiveFailures: 0,
    lastFailureCode: 0,
    openedAt: 0,
};

/**
 * 서킷 브레이커 상태 확인 — 요청 전 호출
 *
 * OPEN 상태에서 RESET_MS 경과 시 자동 HALF-OPEN (리셋) 전환합니다.
 * OPEN 상태에서 RESET_MS 미경과 시 즉시 Error를 throw합니다.
 *
 * @throws {Error} 서킷 브레이커가 OPEN이고 리셋 시간 미경과 시
 */
function checkCircuitBreaker(): void {
    if (!circuitState.isOpen) return;

    // 자동 리셋 (HALF-OPEN → CLOSED 전환)
    if (Date.now() - circuitState.openedAt > CIRCUIT_BREAKER_RESET_MS) {
        logger.info(`🟢 Firecrawl 서킷 브레이커 리셋 (${CIRCUIT_BREAKER_RESET_MS / 1000}초 경과)`);
        circuitState.isOpen = false;
        circuitState.consecutiveFailures = 0;
        return;
    }

    const remainingSec = Math.ceil(
        (CIRCUIT_BREAKER_RESET_MS - (Date.now() - circuitState.openedAt)) / 1000
    );
    throw new Error(
        `Firecrawl 서킷 브레이커 OPEN: 연속 ${circuitState.consecutiveFailures}회 HTTP ${circuitState.lastFailureCode} 실패. ` +
        `${remainingSec}초 후 자동 리셋`
    );
}

/**
 * 실패 기록 — HTTP 에러 응답 수신 시 호출
 *
 * CIRCUIT_BREAKER_CODES에 해당하는 상태 코드가 THRESHOLD 이상 연속 발생하면
 * 서킷 브레이커를 OPEN으로 전환합니다.
 * 인증/크레딧 이외의 에러(5xx, 타임아웃 등)는 연속 카운터를 리셋합니다.
 *
 * @param statusCode - HTTP 응답 상태 코드
 */
function recordCircuitFailure(statusCode: number): void {
    if (!CIRCUIT_BREAKER_CODES.has(statusCode)) {
        // 인증/크레딧 이외의 에러는 연속 카운터 리셋 (다른 종류의 일시적 에러)
        circuitState.consecutiveFailures = 0;
        return;
    }

    circuitState.consecutiveFailures++;
    circuitState.lastFailureCode = statusCode;

    if (circuitState.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        circuitState.isOpen = true;
        circuitState.openedAt = Date.now();
        logger.warn(
            `🔴 Firecrawl 서킷 브레이커 OPEN: 연속 ${circuitState.consecutiveFailures}회 ` +
            `HTTP ${statusCode} 실패 — ${CIRCUIT_BREAKER_RESET_MS / 1000}초간 요청 차단`
        );
    }
}

/**
 * 성공 기록 — 요청 성공 시 호출하여 서킷 브레이커 상태 리셋
 */
function recordCircuitSuccess(): void {
    if (circuitState.consecutiveFailures > 0 || circuitState.isOpen) {
        if (circuitState.isOpen) {
            logger.info('🟢 Firecrawl 서킷 브레이커 CLOSED (성공 복구)');
        }
        circuitState.consecutiveFailures = 0;
        circuitState.isOpen = false;
    }
}

// ============================================
// Firecrawl API Post
// ============================================

/**
 * Firecrawl API POST 요청 옵션
 */
export interface FirecrawlPostOptions {
    /** Firecrawl API 기본 URL (예: 'https://api.firecrawl.dev/v1') */
    apiUrl: string;
    /** Firecrawl API 인증 키 */
    apiKey: string;
    /** API 엔드포인트 (예: '/scrape', '/search', '/map', '/crawl') */
    endpoint: string;
    /** 요청 본문 데이터 */
    data: Record<string, unknown>;
    /** AbortSignal (요청 취소용, 선택사항) */
    signal?: AbortSignal;
    /** 요청 타임아웃 (ms, 선택사항 — 자체 AbortController로 타임아웃 적용) */
    timeoutMs?: number;
}

/**
 * Firecrawl API POST 요청 공통 헬퍼
 *
 * Bearer 토큰 인증으로 Firecrawl API 엔드포인트에 POST 요청을 보냅니다.
 * AbortSignal과 타임아웃을 모두 지원합니다.
 * 서킷 브레이커가 OPEN이면 HTTP 요청 없이 즉시 Error를 throw합니다.
 *
 * @param options - 요청 옵션
 * @returns API 응답 JSON (파싱됨)
 * @throws {Error} HTTP 에러, 타임아웃, 요청 취소, 또는 서킷 브레이커 OPEN 시
 */
export async function firecrawlPost(options: FirecrawlPostOptions): Promise<unknown> {
    // 서킷 브레이커 체크 — OPEN이면 HTTP 요청 없이 즉시 throw
    checkCircuitBreaker();

    const { apiUrl, apiKey, endpoint, data, signal, timeoutMs } = options;
    const url = `${apiUrl}${endpoint}`;

    logger.info(`요청: ${endpoint}`);

    // Defense-in-depth: validate user-supplied URL in request payload
    if (typeof data.url === 'string') {
        await validateOutboundUrl(data.url);
    }

    // 타임아웃 처리: 외부 signal과 내부 타임아웃 signal을 결합
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let effectiveSignal: AbortSignal | undefined = signal;

    if (timeoutMs && !signal) {
        // signal 없이 타임아웃만 있는 경우: 내부 AbortController 생성
        const controller = new AbortController();
        timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
        effectiveSignal = controller.signal;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(data),
            signal: effectiveSignal
        });

        if (!response.ok) {
            // 서킷 브레이커에 실패 기록 (인증/크레딧 에러 시 트립)
            recordCircuitFailure(response.status);
            const errorText = await response.text();
            throw new Error(`Firecrawl API 오류 (${response.status}): ${errorText}`);
        }

        // 성공 — 서킷 브레이커 상태 리셋
        recordCircuitSuccess();
        return await response.json();
    } catch (error: unknown) {
        // 서킷 브레이커 자체 에러는 재로깅하지 않음
        if (error instanceof Error && error.message.startsWith('Firecrawl 서킷 브레이커')) {
            throw error;
        }
        logger.error(`요청 실패 (${endpoint}):`, errorMessage(error));
        throw error;
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}

/**
 * Firecrawl 서킷 브레이커 상태 조회 (모니터링/디버깅용)
 *
 * @returns 현재 서킷 브레이커 상태
 */
export function getFirecrawlCircuitStatus(): {
    isOpen: boolean;
    consecutiveFailures: number;
    lastFailureCode: number;
    remainingResetMs: number;
} {
    return {
        isOpen: circuitState.isOpen,
        consecutiveFailures: circuitState.consecutiveFailures,
        lastFailureCode: circuitState.lastFailureCode,
        remainingResetMs: circuitState.isOpen
            ? Math.max(0, CIRCUIT_BREAKER_RESET_MS - (Date.now() - circuitState.openedAt))
            : 0,
    };
}
