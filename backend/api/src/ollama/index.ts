/**
 * Ollama 모듈 인덱스
 * 
 * Ollama Cloud 연동을 위한 모든 기능을 내보냅니다.
 */

// 클라이언트
export { OllamaClient, createClient } from './client';

// 타입
export * from './types';

// Agent Loop (Multi-turn Tool Calling)
export {
    runAgentLoop,
    executeSingleToolCall,
    mcpToolToOllamaTool,
    mcpToolsToOllamaTools
} from './agent-loop';
export type { AgentLoopOptions, AgentLoopResult } from './agent-loop';

// API 키 관리
export { getApiKeyManager, ApiKeyManager } from './api-key-manager';
export type { KeyModelPair, ApiKeyConfig } from './api-key-manager';

// 🆕 멀티모델 클라이언트 (A2A 병렬 처리)
export { 
    getMultiModelClientFactory, 
    MultiModelClientFactory,
    resetMultiModelClientFactory 
} from './multi-model-client';
export type { ParallelChatResult, ModelClient } from './multi-model-client';

// API 사용량 추적
export { getApiUsageTracker } from './api-usage-tracker';
