/**
 * ============================================================
 * Metrics Recorder — 메트릭 기록 및 보안 사후 검사 모듈
 * ============================================================
 *
 * 사용량 메트릭을 기록하고 보안 사후 검사 및 라우팅 로그를 완료합니다.
 * ChatService.recordMetricsAndVerify 메서드에서 추출되었습니다.
 *
 * @module services/chat-service/metrics-recorder
 */
import { createLogger } from '../../utils/logger';
import type { AgentSelection } from '../../agents';
import { AGENTS } from '../../agents';
import type { ExecutionPlan } from '../../chat/profile-resolver';
import { postResponseCheck, preRequestCheck } from '../../chat/security-hooks';
import { logRoutingDecision, type RoutingDecisionLog } from '../../chat/routing-logger';
import { recordChatMetrics } from '../chat-service-metrics';
import type { ChatMessageRequest } from '../chat-service-types';

const logger = createLogger('MetricsRecorder');

/**
 * recordMetricsAndVerify 함수의 입력 파라미터
 */
export interface MetricsRecordParams {
    /** 생성된 전체 응답 */
    fullResponse: string;
    /** 요청 시작 시각 (ms) */
    startTime: number;
    /** 사용자 원본 메시지 */
    message: string;
    /** 현재 사용 중인 모델명 */
    model: string;
    /** 채팅 메시지 요청 객체 */
    req: ChatMessageRequest;
    /** 선택된 에이전트 정보 */
    selectedAgent: (typeof AGENTS)[string];
    /** 에이전트 선택 결과 */
    agentSelection: AgentSelection;
    /** Brand Model 실행 계획 */
    executionPlan: ExecutionPlan | undefined;
    /** 보안 사전 검사 결과 */
    securityPreCheck: ReturnType<typeof preRequestCheck>;
    /** 라우팅 결정 로그 */
    routingLog: RoutingDecisionLog;
}

/**
 * 사용량 메트릭을 기록하고 보안 사후 검사 및 라우팅 로그를 완료합니다.
 *
 * @param params - 메트릭 기록에 필요한 파라미터
 */
export function recordMetricsAndVerify(params: MetricsRecordParams): void {
    const {
        fullResponse, startTime, message, model, req, selectedAgent,
        agentSelection, executionPlan, securityPreCheck, routingLog,
    } = params;

    recordChatMetrics({
        fullResponse,
        startTime,
        message,
        model,
        apiKeyId: req.apiKeyId,
        selectedAgent,
        agentSelection,
        executionPlan,
    });

    // ── 보안 사후 검사 + 라우팅 로그 완료 ──
    const securityPostCheck = postResponseCheck(fullResponse);
    if (!securityPostCheck.passed) {
        logger.warn(`응답 보안 경고: ${securityPostCheck.violations.map(v => v.detail).join(', ')}`);
    }

    routingLog.latencyMs = Date.now() - startTime;
    routingLog.securityFlags = {
        preCheckPassed: securityPreCheck.passed,
        postCheckPassed: securityPostCheck.passed,
        violations: [
            ...securityPreCheck.violations.map(v => `pre:${v.type}`),
            ...securityPostCheck.violations.map(v => `post:${v.type}`),
        ],
    };
    logRoutingDecision(routingLog);
}
