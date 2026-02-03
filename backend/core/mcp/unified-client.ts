/**
 * 통합 MCP 클라이언트
 * 핵심 MCP 도구를 통합하여 대시보드에서 사용
 * Sequential Thinking, Web Search, PDF Tools
 */

import { MCPServer, createMCPServer } from './server';
import { builtInTools } from './tools';
import { getSequentialThinkingServer, applySequentialThinking } from './sequential-thinking';
import { MCPToolDefinition, MCPToolResult } from './types';

// MCP 기능 상태
export interface MCPFeatureState {
    sequentialThinking: boolean;
    webSearch: boolean;
}

// 통합 MCP 클라이언트
export class UnifiedMCPClient {
    private server: MCPServer;
    private featureState: MCPFeatureState = {
        sequentialThinking: true,
        webSearch: false
    };

    constructor() {
        this.server = createMCPServer('ollama-unified-mcp', '1.0.0');
        console.log(`[MCP] 통합 MCP 클라이언트 초기화 - ${this.getToolCount()}개 도구 등록됨`);
    }

    /**
     * 기능 상태 설정
     */
    async setFeatureState(state: Partial<MCPFeatureState>): Promise<void> {
        this.featureState = { ...this.featureState, ...state };
        console.log(`[MCP] 기능 상태 업데이트:`, this.featureState);
    }

    /**
     * 현재 기능 상태 조회
     */
    getFeatureState(): MCPFeatureState {
        return { ...this.featureState };
    }

    /**
     * 등록된 도구 수 조회
     */
    getToolCount(): number {
        return this.server.getTools().length;
    }

    /**
     * 모든 도구 목록 조회
     */
    getToolList(): string[] {
        return this.server.getTools().map(t => t.name);
    }

    /**
     * 도구 카테고리별 분류
     */
    getToolsByCategory(): Record<string, string[]> {
        const tools = this.server.getTools();
        const categories: Record<string, string[]> = {
            file: [],
            command: [],
            search: []
        };

        for (const tool of tools) {
            if (tool.name.includes('file')) {
                categories.file.push(tool.name);
            } else if (tool.name.includes('command')) {
                categories.command.push(tool.name);
            } else if (tool.name.includes('search')) {
                categories.search.push(tool.name);
            }
        }

        return categories;
    }

    /**
     * 도구 실행
     */
    async executeTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
        const response = await this.server.handleRequest({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
                name: toolName,
                arguments: args
            }
        });

        if (response.error) {
            return {
                content: [{ type: 'text', text: response.error.message }],
                isError: true
            };
        }

        return response.result as MCPToolResult;
    }

    /**
     * 외부 MCP 요청 처리 (SSE 핸들러용)
     */
    async handleMCPRequest(request: any): Promise<any> {
        return this.server.handleRequest(request);
    }

    /**
     * 메시지에 MCP 기능 적용
     */
    enhanceMessage(message: string): string {
        let enhanced = message;

        // Sequential Thinking 적용
        if (this.featureState.sequentialThinking) {
            enhanced = applySequentialThinking(enhanced, true);
        }

        return enhanced;
    }

    /**
     * 상태 초기화
     */
    reset(): void {
        if (this.featureState.sequentialThinking) {
            getSequentialThinkingServer().reset();
        }
        console.log('[MCP] 상태 초기화 완료');
    }

    /**
     * 통계 조회
     */
    getStats(): {
        tools: number;
        features: MCPFeatureState;
    } {
        return {
            tools: this.getToolCount(),
            features: this.getFeatureState()
        };
    }
}

// 싱글톤 인스턴스
let unifiedClient: UnifiedMCPClient | null = null;

export function getUnifiedMCPClient(): UnifiedMCPClient {
    if (!unifiedClient) {
        unifiedClient = new UnifiedMCPClient();
    }
    return unifiedClient;
}

export function createUnifiedMCPClient(): UnifiedMCPClient {
    return new UnifiedMCPClient();
}
