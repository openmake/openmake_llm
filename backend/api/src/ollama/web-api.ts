/**
 * ============================================================
 * Web API - Ollama Web Search/Fetch API 모듈
 * ============================================================
 *
 * Ollama 공식 Web Search 및 Web Fetch API 호출을 담당합니다.
 * Cloud 호스트를 통해 웹 검색 및 페이지 콘텐츠 추출을 수행합니다.
 *
 * @module ollama/web-api
 */
import { AxiosInstance } from 'axios';
import {
    WebSearchRequest,
    WebSearchResponse,
    WebFetchRequest,
    WebFetchResponse
} from './types';
import { OLLAMA_CLOUD_HOST } from '../config/constants';
import { ApiKeyManager } from './api-key-manager';
import { createLogger } from '../utils/logger';

const logger = createLogger('OllamaWebApi');

/**
 * Ollama 공식 Web Search API를 호출합니다.
 *
 * @param client - Axios HTTP 클라이언트 인스턴스
 * @param apiKeyManager - API Key 관리자
 * @param boundKeyIndex - 바인딩된 키 인덱스
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 5, 최대: 10)
 * @returns 웹 검색 결과
 */
export async function webSearch(
    client: AxiosInstance,
    apiKeyManager: ApiKeyManager,
    boundKeyIndex: number,
    query: string,
    maxResults: number = 5
): Promise<WebSearchResponse> {
    const request: WebSearchRequest = {
        query,
        max_results: Math.min(maxResults, 10)
    };

    logger.info(`Web Search: "${query}"`);

    try {
        const response = await client.post<WebSearchResponse>(
            `${OLLAMA_CLOUD_HOST}/api/web_search`,
            request,
            {
                baseURL: '',
                headers: {
                    'Content-Type': 'application/json',
                    ...apiKeyManager.getAuthHeadersForIndex(boundKeyIndex)
                }
            }
        );

        logger.info(`Web Search: ${response.data.results?.length || 0}개 결과`);
        return response.data;
    } catch (error: unknown) {
        logger.warn('웹 검색 실패:', error);
        return {
            results: [],
            error: error instanceof Error ? error.message : 'Web search failed'
        };
    }
}

/**
 * Ollama 공식 Web Fetch API를 호출합니다.
 *
 * @param client - Axios HTTP 클라이언트 인스턴스
 * @param apiKeyManager - API Key 관리자
 * @param boundKeyIndex - 바인딩된 키 인덱스
 * @param url - 가져올 URL
 * @returns 페이지 콘텐츠 (title, content, links)
 */
export async function webFetch(
    client: AxiosInstance,
    apiKeyManager: ApiKeyManager,
    boundKeyIndex: number,
    url: string
): Promise<WebFetchResponse> {
    const request: WebFetchRequest = { url };

    logger.info(`Web Fetch: ${url}`);

    try {
        const response = await client.post<WebFetchResponse>(
            `${OLLAMA_CLOUD_HOST}/api/web_fetch`,
            request,
            {
                baseURL: '',
                headers: {
                    'Content-Type': 'application/json',
                    ...apiKeyManager.getAuthHeadersForIndex(boundKeyIndex)
                }
            }
        );

        logger.info(`Web Fetch: "${response.data.title}"`);
        return response.data;
    } catch (error: unknown) {
        logger.error('Web Fetch 실패:', (error instanceof Error ? error.message : String(error)));
        return { title: '', content: '', links: [] };
    }
}
