/**
 * ============================================================
 * Interceptors - Axios 요청/응답 인터셉터 모듈
 * ============================================================
 *
 * API Key 자동 주입, 키 로테이션, 네트워크 에러 재시도 등
 * Axios 인터셉터 설정을 담당합니다.
 *
 * @module ollama/interceptors
 */
import { AxiosInstance } from 'axios';
import { ApiKeyManager } from './api-key-manager';
import { KeyExhaustionError } from '../errors/key-exhaustion.error';
import { createLogger } from '../utils/logger';

const logger = createLogger('OllamaInterceptors');

/**
 * 인터셉터에서 boundKeyIndex를 읽고 쓸 수 있는 참조 인터페이스.
 * OllamaClient 인스턴스의 boundKeyIndex를 간접 참조합니다.
 */
export interface KeyIndexRef {
    boundKeyIndex: number;
}

/**
 * Axios 인스턴스에 요청/응답 인터셉터를 설정합니다.
 *
 * 요청 인터셉터:
 * - 매 요청마다 현재 활성 API Key를 Authorization 헤더에 동적 주입
 *
 * 응답 인터셉터:
 * - 성공 시 키 성공 기록
 * - 429/401/403/400/502 에러 시 API Key 자동 스와핑 후 재시도 (최대 3회)
 * - 네트워크 에러(ETIMEDOUT 등) 시 지수 백오프로 최대 2회 재시도
 * - 모든 키 소진 시 KeyExhaustionError throw
 *
 * @param client - Axios HTTP 클라이언트 인스턴스
 * @param apiKeyManager - API Key 관리자
 * @param keyRef - boundKeyIndex 참조 객체 (읽기/쓰기)
 */
export function setupInterceptors(
    client: AxiosInstance,
    apiKeyManager: ApiKeyManager,
    keyRef: KeyIndexRef
): void {
    // 요청 인터셉터: per-instance bound key 주입
    client.interceptors.request.use((config) => {
        const authHeaders = apiKeyManager.getAuthHeadersForIndex(keyRef.boundKeyIndex);
        if (authHeaders.Authorization) {
            config.headers.Authorization = authHeaders.Authorization;
        }
        return config;
    });

    // 응답 인터셉터: 실패 시 폴백 처리
    client.interceptors.response.use(
        (response) => {
            apiKeyManager.recordKeySuccess(keyRef.boundKeyIndex);
            return response;
        },
        async (error) => {
            const statusCode = error?.response?.status;
            logger.info(`요청 실패 - 상태 코드: ${statusCode}`);

            // 네트워크 에러 감지
            const isNetworkError = !statusCode && (
                error.code === 'ETIMEDOUT' ||
                error.code === 'ECONNREFUSED' ||
                error.code === 'ECONNRESET' ||
                error.code === 'ENOTFOUND' ||
                error.code === 'EAI_AGAIN'
            );

            // 429, 401, 403, 400, 502 에러 시 API 키 스와핑 시도
            if (statusCode === 429 || statusCode === 401 || statusCode === 403 || statusCode === 400 || statusCode === 502) {
                apiKeyManager.recordKeyFailure(keyRef.boundKeyIndex, error);

                const retryCount = error.config?._retryCount || 0;
                const alternateKeyIndex = apiKeyManager.getNextAvailableKey(keyRef.boundKeyIndex);

                if (alternateKeyIndex !== -1 && error.config && retryCount < 3) {
                    keyRef.boundKeyIndex = alternateKeyIndex;
                    error.config._retryCount = retryCount + 1;
                    const newAuthHeaders = apiKeyManager.getAuthHeadersForIndex(keyRef.boundKeyIndex);
                    error.config.headers.Authorization = newAuthHeaders.Authorization;
                    logger.info(`키풀 폴백 재시도 (Key ${keyRef.boundKeyIndex + 1})...`);
                    return client.request(error.config);
                } else {
                    logger.info(`키풀 소진 - 사용 가능한 키 없음 (boundKey: ${keyRef.boundKeyIndex + 1})`);

                    const nextResetTime = apiKeyManager.getNextResetTime();
                    if (nextResetTime) {
                        const totalKeys = apiKeyManager.getTotalKeys();
                        const keysInCooldown = apiKeyManager.getKeysInCooldownCount();
                        throw new KeyExhaustionError(nextResetTime, totalKeys, keysInCooldown);
                    }
                }
            } else if (isNetworkError && error.config) {
                // 네트워크 일시 장애 시 최대 2회 재시도 (지수 백오프)
                const retryCount = error.config._retryCount || 0;
                const maxNetworkRetries = 2;
                if (retryCount < maxNetworkRetries) {
                    error.config._retryCount = retryCount + 1;
                    const backoffMs = Math.pow(2, retryCount) * 1000;
                    logger.info(`네트워크 에러(${error.code}) - ${backoffMs}ms 후 재시도 (${retryCount + 1}/${maxNetworkRetries})`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    return client.request(error.config);
                }
                logger.info(`네트워크 재시도 소진 (${error.code})`);
                if (error.code !== 'ENOTFOUND' && error.code !== 'EAI_AGAIN') {
                    apiKeyManager.recordKeyFailure(keyRef.boundKeyIndex, error);
                }
            } else {
                apiKeyManager.recordKeyFailure(keyRef.boundKeyIndex, error);
            }

            throw error;
        }
    );
}
