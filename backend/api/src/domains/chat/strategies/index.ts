/**
 * ============================================================
 * Chat Strategies - 채팅 전략 패턴 배럴 익스포트
 * ============================================================
 *
 * ChatService에서 사용하는 5가지 채팅 전략 클래스와
 * 관련 타입 정의를 단일 진입점으로 재수출합니다.
 *
 * @module services/chat-strategies
 * @description
 * - 전략 클래스: A2A, Direct, Discussion, DeepResearch, AgentLoop
 * - 타입: 각 전략별 Context/Result 인터페이스
 */
export { A2AStrategy } from './a2a-strategy';
export { DirectStrategy } from './direct-strategy';
export { DiscussionStrategy } from './discussion-strategy';
export { DeepResearchStrategy } from './deep-research-strategy';
export { AgentLoopStrategy } from './agent-loop-strategy';
export type {
    ChatContext,
    ChatResult,
    ChatStrategy,
    A2AStrategyContext,
    A2AStrategyResult,
    DirectStrategyContext,
    DirectStrategyResult,
    AgentLoopStrategyContext,
    DiscussionStrategyContext,
    DeepResearchStrategyContext,
} from './types';
