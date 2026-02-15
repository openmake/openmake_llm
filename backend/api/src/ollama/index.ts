/**
 * ============================================================
 * Ollama Module - Barrel Export 인덱스
 * ============================================================
 *
 * Ollama 모듈의 모든 공개 API를 하나의 진입점으로 내보냅니다.
 * 외부 모듈에서는 이 파일을 통해 Ollama 관련 기능에 접근합니다.
 *
 * @module ollama
 * @description
 * - OllamaClient: HTTP 클라이언트 (Generate, Chat, Embed, WebSearch)
 * - Agent Loop: Multi-turn Tool Calling 에이전트 루프
 * - ApiKeyManager: Cloud API Key 자동 로테이션
 * - MultiModelClientFactory: A2A 병렬 생성 클라이언트 팩토리
 * - ApiUsageTracker: 사용량 추적 및 쿼터 관리
 * - Types: 모든 Ollama API 타입/인터페이스
 */

// 클라이언트 — Ollama HTTP 통신 핵심 클래스
export { OllamaClient, createClient } from './client';

// 타입 — 모든 Ollama API 타입/인터페이스/프리셋/헬퍼
export * from './types';

// Agent Loop — Multi-turn Tool Calling 에이전트 루프
export {
    runAgentLoop,
    executeSingleToolCall,
    mcpToolToOllamaTool,
    mcpToolsToOllamaTools
} from './agent-loop';
export type { AgentLoopOptions, AgentLoopResult } from './agent-loop';

// API 키 관리 — Cloud API Key 자동 로테이션
export { getApiKeyManager, ApiKeyManager } from './api-key-manager';
export type { KeyModelPair, ApiKeyConfig } from './api-key-manager';

// 멀티모델 클라이언트 — A2A 병렬 생성
export { 
    getMultiModelClientFactory, 
    MultiModelClientFactory,
    resetMultiModelClientFactory 
} from './multi-model-client';
export type { ParallelChatResult, ModelClient } from './multi-model-client';

// API 사용량 추적 — 쿼터 관리 및 통계
export { getApiUsageTracker } from './api-usage-tracker';
