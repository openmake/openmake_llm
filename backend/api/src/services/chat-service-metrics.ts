/**
 * ============================================================
 * ChatService 모니터링 메트릭 기록 모듈
 * ============================================================
 *
 * 채팅 응답 생성 후 사용량 추적 및 모니터링 메트릭을 기록합니다.
 * 메트릭 기록 실패는 응답 반환에 영향을 주지 않습니다.
 *
 * @module services/chat-service-metrics
 */
import { createLogger } from '../utils/logger';
import { getApiKeyManager } from '../ollama/api-key-manager';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import type { ExecutionPlan } from '../chat/profile-resolver';

const logger = createLogger('ChatService');

/**
 * 채팅 응답 생성 후 사용량 추적 및 모니터링 메트릭을 기록합니다.
 *
 * API 사용량 추적, MetricsCollector, AnalyticsSystem에 데이터를 기록합니다.
 * 기록 실패 시에도 예외를 던지지 않으며, 로그만 남깁니다.
 *
 * @param params - 메트릭 기록에 필요한 파라미터
 * @param params.fullResponse - AI가 생성한 전체 응답 문자열
 * @param params.startTime - 요청 처리 시작 시간 (Date.now() 값)
 * @param params.message - 사용자 입력 메시지
 * @param params.model - 사용된 모델 이름
 * @param params.selectedAgent - 선택된 에이전트 정보
 * @param params.agentSelection - 에이전트 라우팅 결과
 * @param params.executionPlan - Brand Model 실행 계획 (선택적)
 */
export function recordChatMetrics(params: {
    fullResponse: string;
    startTime: number;
    message: string;
    model: string;
    selectedAgent: { name: string };
    agentSelection: { primaryAgent: string };
    executionPlan?: ExecutionPlan;
}): void {
    const { fullResponse, startTime, message, model, selectedAgent, agentSelection, executionPlan } = params;

    // 사용량 추적 및 모니터링 메트릭 기록 (실패해도 응답 반환에 영향 없음)
    try {
        const usageTracker = getApiUsageTracker();
        const keyManager = getApiKeyManager();
        const currentKey = keyManager.getCurrentKey();

        const responseTime = Date.now() - startTime;
        const tokenCount = fullResponse.length;

        usageTracker.recordRequest({
            tokens: tokenCount,
            responseTime,
            model,
            apiKeyId: currentKey ? currentKey.substring(0, 8) : undefined,
            profileId: executionPlan?.isBrandModel ? executionPlan.requestedModel : undefined,
        });

        try {
            const { getMetrics } = require('../monitoring/metrics');
            const metricsCollector = getMetrics();

            metricsCollector.incrementCounter('chat_requests_total', 1, { model });
            metricsCollector.recordResponseTime(responseTime, model);
            metricsCollector.recordTokenUsage(tokenCount, model);

            if (currentKey) {
                metricsCollector.incrementCounter('api_key_usage', 1, { keyId: currentKey.substring(0, 8) });
            }
        } catch (e) {
            logger.warn('MetricsCollector 기록 실패:', e);
        }

        try {
            const { getAnalyticsSystem } = require('../monitoring/analytics');
            const analytics = getAnalyticsSystem();

            const agentName = selectedAgent ? selectedAgent.name : 'General Chat';
            const agentId = agentSelection?.primaryAgent || 'general';

            analytics.recordAgentRequest(
                agentId,
                agentName,
                responseTime,
                true,
                tokenCount
            );

            analytics.recordQuery(message);
        } catch (e) {
            logger.warn('AnalyticsSystem 기록 실패:', e);
        }
    } catch (e) {
        logger.error('모니터링 데이터 기록 실패:', e);
    }
}
