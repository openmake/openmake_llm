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
// model-resolver: 2026-05-26 제거 (Phase B Phase 2-A) — ExecutionPlanBuilder 가
// chat/execution-plan-builder.ts 에서 통합 처리.
// strategy-executor: 2026-07-18 strategy 계층 폐기 1단계 — 배선 제거 (파일 삭제는 2단계)
// memory-extractor: 2026-05-19 제거 (MemoryService 폐기)
export { resolveAgent, type AgentResolutionResult } from './agent-resolver';
export { resolveLanguagePolicy } from './language-resolver';
export { recordMetricsAndVerify, type MetricsRecordParams } from './metrics-recorder';
