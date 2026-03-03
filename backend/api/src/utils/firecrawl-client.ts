/**
 * ============================================================
 * Firecrawl HTTP Client - 공유 HTTP 헬퍼
 * ============================================================
 *
 * MCP firecrawl 도구와 DeepResearchService 양쪽에서 사용하는
 * 공통 Firecrawl API 호출 헬퍼입니다.
 *
 * @module utils/firecrawl-client
 * @see mcp/firecrawl.ts - MCP 도구 핸들러 (이 헬퍼 사용)
 * @see services/DeepResearchService.ts - 심층 연구 스크래핑 (이 헬퍼 사용)
 */

import { createLogger } from './logger';

const logger = createLogger('FirecrawlClient');

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
 *
 * @param options - 요청 옵션
 * @returns API 응답 JSON (파싱됨)
 * @throws {Error} HTTP 에러, 타임아웃, 또는 요청 취소 시
 */
export async function firecrawlPost(options: FirecrawlPostOptions): Promise<unknown> {
    const { apiUrl, apiKey, endpoint, data, signal, timeoutMs } = options;
    const url = `${apiUrl}${endpoint}`;

    logger.info(`요청: ${endpoint}`);

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
            const errorText = await response.text();
            throw new Error(`Firecrawl API 오류 (${response.status}): ${errorText}`);
        }

        return await response.json();
    } catch (error: unknown) {
        logger.error(`요청 실패 (${endpoint}):`, (error instanceof Error ? error.message : String(error)));
        throw error;
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
