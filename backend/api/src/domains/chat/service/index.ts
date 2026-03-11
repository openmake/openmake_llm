/**
 * ============================================================
 * Chat Service Module — 통합 진입점 (Barrel)
 * ============================================================
 *
 * ChatService 관련 클래스, 타입, 포매터, 메트릭스를
 * 단일 경로로 import할 수 있도록 re-export합니다.
 *
 * @example
 * import { ChatService, type ChatMessageRequest, formatResearchResult } from '../services/chat-service';
 *
 * @module services/chat-service
 */

// ── Service ──────────────────────────────────────────
export { ChatService } from '../service';

// ── Types ────────────────────────────────────────────
export type {
    ChatMessageRequest,
    ChatResponseMeta,
    ChatServiceConfig,
    ChatHistoryMessage,
    AgentSelectionInfo,
    ToolCallInfo,
    WebSearchResult,
} from './chat-service-types';

export { WebSearchFunction } from './chat-service-types';

// ── Formatters ───────────────────────────────────────
export {
    formatDiscussionResult,
    formatResearchResult,
} from './chat-service-formatters';

// ── Metrics ──────────────────────────────────────────
export { recordChatMetrics } from './chat-service-metrics';
