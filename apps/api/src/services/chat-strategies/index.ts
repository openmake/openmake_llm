/**
 * ============================================================
 * Chat Strategies - 채팅 전략 패턴 배럴 익스포트
 * ============================================================
 *
 * 특수 모드 전략 2종(Discussion/DeepResearch)과 관련 타입을 단일 진입점으로
 * 재수출합니다. (구 Direct/GenerateVerify/AgentLoop/Thinking 전략은 2026-07-18
 * strategy 계층 폐기 2단계로 삭제 — 일반 채팅은 streamFromExternalProvider
 * 단일 경로. 상세는 CLAUDE.md Phase 용어집.)
 *
 * @module services/chat-strategies
 */
export { DiscussionStrategy } from './discussion-strategy';
export { DeepResearchStrategy } from './deep-research-strategy';
export type {
    ChatContext,
    ChatResult,
    ChatStrategy,
    DiscussionStrategyContext,
    DeepResearchStrategyContext,
} from './types';
