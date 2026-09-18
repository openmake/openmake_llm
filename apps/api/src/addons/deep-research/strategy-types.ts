/**
 * @module addons/deep-research/strategy-types
 */
import type { LLMClient } from '../../llm';
import type { ChatMessageRequest } from '../../services/chat-service-types';
import type { ChatContext } from '../../services/chat-strategies/types';
import type { ResearchProgress } from './service';

/**
 * DeepResearch(심층 연구) 전략 컨텍스트
 *
 * 자율적 다단계 리서치 수행에 필요한 컨텍스트입니다.
 *
 * @interface DeepResearchStrategyContext
 * @extends ChatContext
 */
export interface DeepResearchStrategyContext extends ChatContext {
    /** 원본 채팅 메시지 요청 */
    req: ChatMessageRequest;
    /** LLM 클라이언트 인스턴스 */
    client: LLMClient;
    /** 연구 진행 상황 콜백 */
    onProgress?: (progress: ResearchProgress) => void;
    /** 연구 결과를 마크다운으로 포맷팅하는 함수 */
    formatResearchResult: (result: {
        /** 연구 주제 */
        topic: string;
        /** 종합 요약 */
        summary: string;
        /** 주요 발견사항 목록 */
        keyFindings: string[];
        /** 참고 자료 목록 */
        sources: Array<{ title: string; url: string }>;
        /** 총 연구 단계 수 */
        totalSteps: number;
        /** 총 소요 시간 (밀리초) */
        duration: number;
    }) => string;
}
