/**
 * 통합 MCP 클라이언트
 * 핵심 MCP 도구를 통합하여 대시보드에서 사용
 * Sequential Thinking, Web Search, PDF Tools
 */

import { MCPServer, createMCPServer } from './server';
import { getSequentialThinkingServer, applySequentialThinking } from './sequential-thinking';
import { MCPToolDefinition, MCPToolResult, MCPRequest, MCPResponse } from './types';
import { UserTier } from '../data/user-manager';
import { canUseTool, getToolsForTier } from './tool-tiers';
import { UserSandbox, UserContext } from './user-sandbox';
import { ToolRouter } from './tool-router';
import { MCPServerRegistry } from './server-registry';
import type { UnifiedDatabase } from '../data/models/unified-database';

// MCP 기능 상태
export interface MCPFeatureState {
    sequentialThinking: boolean;
    webSearch: boolean;
}

// 통합 MCP 클라이언트
export class UnifiedMCPClient {
    private server: MCPServer;
    private featureState: MCPFeatureState = {
        sequentialThinking: false,  // 🆕 기본값 false (사용자가 🧠 버튼으로 활성화)
        webSearch: false
    };
    private toolRouter: ToolRouter;
    private serverRegistry: MCPServerRegistry;

    constructor() {
        this.server = createMCPServer('ollama-unified-mcp', '1.0.0');
        this.toolRouter = new ToolRouter();
        this.serverRegistry = new MCPServerRegistry(this.toolRouter);
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
    async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
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

    // ============================================
    // 사용자 등급별 도구 접근 제어
    // ============================================

    /**
     * 사용자 등급별 도구 목록 반환
     */
    getToolListForUser(tier: UserTier): string[] {
        const allTools = this.getToolList();
        return getToolsForTier(tier, allTools);
    }

    /**
     * 특정 도구가 tier에서 사용 가능한지 확인
     */
    canUserAccessTool(tier: UserTier, toolName: string): boolean {
        return canUseTool(tier, toolName);
    }

    /**
     * 사용자 컨텍스트로 도구 실행 (권한 검증 포함)
     */
    async executeToolWithContext(
        toolName: string,
        args: Record<string, unknown>,
        context: UserContext
    ): Promise<MCPToolResult> {
        // 권한 검증
        if (!canUseTool(context.tier, toolName)) {
            console.warn(`[MCP] ⚠️ 도구 접근 거부: ${toolName} (tier: ${context.tier})`);
            return {
                content: [{ type: 'text', text: `권한 없음: ${context.tier} 등급에서는 ${toolName} 도구를 사용할 수 없습니다.` }],
                isError: true
            };
        }

        // 파일 경로 인자가 있으면 샌드박스 경로로 변환
        const sandboxedArgs = this.applySandboxPaths(args, context.userId);

        console.log(`[MCP] 🔧 도구 실행: ${toolName} (user: ${context.userId}, tier: ${context.tier})`);
        return this.executeTool(toolName, sandboxedArgs);
    }

    // ============================================
    // 🔌 외부 MCP 서버 관련
    // ============================================

    /**
     * ToolRouter 인스턴스 반환
     */
    getToolRouter(): ToolRouter {
        return this.toolRouter;
    }

    /**
     * MCPServerRegistry 인스턴스 반환
     */
    getServerRegistry(): MCPServerRegistry {
        return this.serverRegistry;
    }

    /**
     * DB에서 외부 서버 설정을 로드하고 연결 초기화
     * 앱 시작 시 한 번 호출
     */
    async initializeExternalServers(db: UnifiedDatabase): Promise<void> {
        await this.serverRegistry.initializeFromDB(db);
    }

    /**
     * 인자 중 경로를 사용자 샌드박스 경로로 변환
     */
    private applySandboxPaths(
        args: Record<string, unknown>,
        userId: string | number
    ): Record<string, unknown> {
        const result = { ...args };

        // 일반적인 경로 인자명
        const pathKeys = ['path', 'file', 'directory', 'dir', 'cwd', 'workdir'];

        for (const key of pathKeys) {
            if (typeof result[key] === 'string') {
                const safePath = UserSandbox.resolvePath(userId, result[key] as string);
                if (safePath) {
                    result[key] = safePath;
                } else {
                    // 경로 탈출 시도 시 빈 결과 반환하도록 표시
                    result[`__blocked_${key}`] = true;
                }
            }
        }

        return result;
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
