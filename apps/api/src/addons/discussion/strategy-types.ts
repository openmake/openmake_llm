/**
 * @module addons/discussion/strategy-types
 */
import type { LLMClient } from '../../llm';
import type { ChatMessageRequest } from '../../services/chat-service-types';
import type { ChatContext } from '../../services/chat-strategies/types';
import type { DiscussionProgress, DiscussionResult } from './engine';

/**
 * Discussion(멀티 에이전트 토론) 전략 컨텍스트
 *
 * 여러 전문가 에이전트가 토론하여 고품질 응답을 생성하는 데 필요한 컨텍스트입니다.
 *
 * @interface DiscussionStrategyContext
 * @extends ChatContext
 */
export interface DiscussionStrategyContext extends ChatContext {
    /** 원본 채팅 메시지 요청 */
    req: ChatMessageRequest;
    /** LLM 클라이언트 인스턴스 */
    client: LLMClient;
    /** 토론 진행 상황 콜백 */
    onProgress?: (progress: DiscussionProgress) => void;
    /** 토론 결과를 마크다운으로 포맷팅하는 함수 */
    formatDiscussionResult: (result: DiscussionResult) => string;
}
