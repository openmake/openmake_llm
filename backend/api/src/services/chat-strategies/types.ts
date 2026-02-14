import type { DiscussionProgress, DiscussionResult } from '../../agents/discussion-engine';
import type { ExecutionPlan } from '../../chat/profile-resolver';
import type { DocumentStore } from '../../documents/store';
import type { UserContext } from '../../mcp/user-sandbox';
import type { OllamaClient } from '../../ollama/client';
import type { ChatMessage, ModelOptions, ToolCall, ToolDefinition } from '../../ollama/types';
import type { ResearchProgress } from '../DeepResearchService';
import type { ChatMessageRequest } from '../ChatService';

export interface ChatContext {
    onToken: (token: string) => void;
    abortSignal?: AbortSignal;
    checkAborted?: () => void;
}

export interface ChatResult {
    response: string;
    metrics?: Record<string, unknown>;
    succeeded?: boolean;
}

export interface ChatStrategy<TContext extends ChatContext = ChatContext, TResult extends ChatResult = ChatResult> {
    execute(context: TContext): Promise<TResult>;
}

export interface A2AStrategyContext extends ChatContext {
    messages: ChatMessage[];
    chatOptions: ModelOptions;
}

export interface A2AStrategyResult extends ChatResult {
    succeeded: boolean;
}

export interface DirectStrategyContext extends ChatContext {
    client: OllamaClient;
    currentHistory: ChatMessage[];
    chatOptions: ModelOptions;
    allowedTools: ToolDefinition[];
    thinkOption?: 'low' | 'medium' | 'high';
}

export interface DirectStrategyResult extends ChatResult {
    assistantMessage: ChatMessage;
    toolCalls: ToolCall[];
}

export interface AgentLoopStrategyContext extends ChatContext {
    client: OllamaClient;
    currentHistory: ChatMessage[];
    chatOptions: ModelOptions;
    maxTurns: number;
    supportsTools: boolean;
    supportsThinking: boolean;
    thinkingMode?: boolean;
    thinkingLevel?: 'low' | 'medium' | 'high';
    executionPlan?: ExecutionPlan;
    currentUserContext: UserContext | null;
    getAllowedTools: () => ToolDefinition[];
}

export interface DiscussionStrategyContext extends ChatContext {
    req: ChatMessageRequest;
    uploadedDocuments: DocumentStore;
    client: OllamaClient;
    onProgress?: (progress: DiscussionProgress) => void;
    formatDiscussionResult: (result: DiscussionResult) => string;
}

export interface DeepResearchStrategyContext extends ChatContext {
    req: ChatMessageRequest;
    client: OllamaClient;
    onProgress?: (progress: ResearchProgress) => void;
    formatResearchResult: (result: {
        topic: string;
        summary: string;
        keyFindings: string[];
        sources: Array<{ title: string; url: string }>;
        totalSteps: number;
        duration: number;
    }) => string;
}
