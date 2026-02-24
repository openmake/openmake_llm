/**
 * ============================================================
 * UnifiedMCPClient - 통합 MCP 클라이언트
 * ============================================================
 *
 * 핵심 MCP 도구를 통합하여 대시보드, REST API, WebSocket에서 사용합니다.
 * MCPServer, ToolRouter, MCPServerRegistry를 하나의 인터페이스로 제공합니다.
 *
 * @module mcp/unified-client
 * @description
 * - MCP 도구 실행 (내장 + 외부)
 * - 사용자 등급(tier) 기반 도구 접근 제어
 * - UserContext 기반 샌드박스 경로 변환
 * - Sequential Thinking 메시지 적용
 * - 기능 상태(Feature State) 관리
 * - 외부 MCP 서버 초기화 (DB 연동)
 * - 싱글톤 인스턴스 제공
 *
 * 계층 구조:
 * UnifiedMCPClient
 * ├── MCPServer (내장 도구 JSON-RPC 처리)
 * ├── ToolRouter (내장 + 외부 도구 통합 라우팅)
 * └── MCPServerRegistry (외부 서버 연결 관리)
 */

import { MCPServer, createMCPServer } from './server';
import { getSequentialThinkingServer, applySequentialThinking } from './sequential-thinking';
import { MCPToolResult, MCPRequest, MCPResponse } from './types';
import { UserTier } from '../data/user-manager';
import { canUseTool, getToolsForTier } from './tool-tiers';
import { UserSandbox, UserContext } from './user-sandbox';
import { ToolRouter } from './tool-router';
import { MCPServerRegistry } from './server-registry';
import type { UnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('MCP');

/**
 * MCP 기능 상태 인터페이스
 *
 * UI에서 토글 가능한 MCP 기능의 활성화 상태를 나타냅니다.
 *
 * @interface MCPFeatureState
 */
export interface MCPFeatureState {
    /** Sequential Thinking 활성화 여부 (기본값: false, UI의 뇌 버튼으로 토글) */
    sequentialThinking: boolean;
    /** 웹 검색 활성화 여부 */
    webSearch: boolean;
}

/**
 * 통합 MCP 클라이언트
 *
 * 애플리케이션 전체에서 MCP 기능을 사용하기 위한 통합 인터페이스입니다.
 * getUnifiedMCPClient()로 싱글톤 인스턴스를 사용합니다.
 *
 * @class UnifiedMCPClient
 */
export class UnifiedMCPClient {
    /** 내장 MCP 서버 (JSON-RPC 도구 처리) */
    private server: MCPServer;
    /** MCP 기능 토글 상태 */
    private featureState: MCPFeatureState = {
        sequentialThinking: false,  // 기본값 false (사용자가 UI 버튼으로 활성화)
        webSearch: false
    };
    /** 내장 + 외부 도구 통합 라우터 */
    private toolRouter: ToolRouter;
    /** 외부 MCP 서버 연결 관리자 */
    private serverRegistry: MCPServerRegistry;

    /**
     * UnifiedMCPClient 인스턴스를 생성합니다.
     *
     * MCPServer, ToolRouter, MCPServerRegistry를 초기화합니다.
     */
    constructor() {
        this.server = createMCPServer('ollama-unified-mcp', '1.0.0');
        this.toolRouter = new ToolRouter();
        this.serverRegistry = new MCPServerRegistry(this.toolRouter);
        logger.info(`통합 MCP 클라이언트 초기화 - ${this.getToolCount()}개 도구 등록됨`);
    }

    /**
     * 기능 상태 설정
     */
    async setFeatureState(state: Partial<MCPFeatureState>): Promise<void> {
        this.featureState = { ...this.featureState, ...state };
        logger.info(`기능 상태 업데이트:`, this.featureState);
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
        logger.info('상태 초기화 완료');
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
            logger.warn(`⚠️ 도구 접근 거부: ${toolName} (tier: ${context.tier})`);
            return {
                content: [{ type: 'text', text: `권한 없음: ${context.tier} 등급에서는 ${toolName} 도구를 사용할 수 없습니다.` }],
                isError: true
            };
        }

        // 파일 경로 인자가 있으면 샌드박스 경로로 변환
        let sandboxedArgs: Record<string, unknown>;
        try {
            sandboxedArgs = this.applySandboxPaths(args, context.userId);
        } catch (error) {
            const message = error instanceof Error ? error.message : '샌드박스 경로 검증 실패';
            logger.warn(`⚠️ 도구 실행 차단: ${toolName} (user: ${context.userId}) - ${message}`);
            return {
                content: [{ type: 'text', text: message }],
                isError: true
            };
        }

        logger.info(`🔧 도구 실행: ${toolName} (user: ${context.userId}, tier: ${context.tier})`);
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
     * 인자 중 파일 경로를 사용자 샌드박스 경로로 변환
     *
     * path, file, directory 등 일반적인 경로 인자명을 감지하여
     * UserSandbox.resolvePath()로 안전한 절대 경로로 변환합니다.
     * 경로 탈출 시도 시 즉시 에러를 발생시켜 도구 실행을 차단합니다.
     *
     * @param args - 원본 도구 실행 인자
     * @param userId - 사용자 ID
     * @returns 샌드박스 경로가 적용된 인자 복사본
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
                    delete result[key];
                    throw new Error(`차단된 경로 인자: ${key}`);
                }
            }
        }

        return result;
    }
}

/** 싱글톤 인스턴스 저장소 */
let unifiedClient: UnifiedMCPClient | null = null;

/**
 * UnifiedMCPClient 싱글톤 인스턴스 반환
 *
 * 최초 호출 시 인스턴스를 생성하고, 이후에는 동일 인스턴스를 반환합니다.
 *
 * @returns UnifiedMCPClient 싱글톤 인스턴스
 */
export function getUnifiedMCPClient(): UnifiedMCPClient {
    if (!unifiedClient) {
        unifiedClient = new UnifiedMCPClient();
    }
    return unifiedClient;
}

/**
 * 새 UnifiedMCPClient 인스턴스 생성
 *
 * 싱글톤이 아닌 독립 인스턴스가 필요한 경우 사용합니다.
 * 주로 테스트에서 사용됩니다.
 *
 * @returns 새 UnifiedMCPClient 인스턴스
 */
export function createUnifiedMCPClient(): UnifiedMCPClient {
    return new UnifiedMCPClient();
}
