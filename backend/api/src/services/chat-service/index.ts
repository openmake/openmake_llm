/**
 * ============================================================
 * Chat Service Module — 통합 진입점 (Barrel)
 * ============================================================
 *
 * ChatService 관련 클래스, 타입, 포매터, 메트릭스,
 * 추출된 서브모듈을 단일 경로로 import할 수 있도록 re-export합니다.
 *
 * @example
 * import { ChatService, type ChatMessageRequest, formatResearchResult } from '../services/chat-service';
 *
 * @module services/chat-service
 */

// ── Service ──────────────────────────────────────────
export { ChatService } from '../ChatService';

// ── Types ────────────────────────────────────────────
export type {
    ChatMessageRequest,
    ChatResponseMeta,
    ChatServiceConfig,
    ChatHistoryMessage,
    AgentSelectionInfo,
    ToolCallInfo,
    WebSearchResult,
} from '../chat-service-types';

export { WebSearchFunction } from '../chat-service-types';

// ── Formatters ───────────────────────────────────────
export {
    formatDiscussionResult,
    formatResearchResult,
} from '../chat-service-formatters';

// ── Metrics ──────────────────────────────────────────
export { recordChatMetrics } from '../chat-service-metrics';

// ── Extracted Submodules ─────────────────────────────
export { buildContextForLLM, type BuildContextParams, type BuildContextResult } from './context-builder';
export { resolveModel, type ResolveModelParams } from './model-resolver';
export { selectAndExecuteStrategy, type StrategyExecutorParams } from './strategy-executor';
export { extractMemoriesAsync, type MemoryExtractorParams } from './memory-extractor';
export { resolveAgent, type AgentResolutionResult } from './agent-resolver';
export { resolveLanguagePolicy } from './language-resolver';
export { recordMetricsAndVerify, type MetricsRecordParams } from './metrics-recorder';
