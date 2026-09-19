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
 * - UserContext 기반 샌드박스 경로 변환
 * - Sequential Thinking 메시지 적용
 * - 외부 MCP 서버 초기화 (DB 연동)
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
import { MCPToolResult } from '../../tool-contract/types';
import type { UserContext } from '../../tool-contract/user-sandbox';
import { executeToolSecurely } from '../../tool-contract/tool-execution-guard';
import { ToolRouter } from './tool-router';
import { MCPServerRegistry } from './server-registry';
import { getUserMCPPool } from './user-pool';
import { type UnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';

const logger = createLogger('MCP');

// 위험 인자 룰·경로 샌드박스·감사는 Base 계약(tool-contract/tool-execution-guard)으로 옮겼다 (2026-09-19).
// 기존 import 경로 호환을 위해 재수출한다.
export { detectDangerousArg } from '../../tool-contract/tool-execution-guard';

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
    /** 내장 + 외부 도구 통합 라우터 */
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
        this.server = createMCPServer('openmake-unified-mcp', '1.0.0');
        this.toolRouter = new ToolRouter({
            userPool: getUserMCPPool(),
        });
        this.serverRegistry = new MCPServerRegistry(this.toolRouter);
        logger.info(`통합 MCP 클라이언트 초기화 - ${this.getToolCount()}개 도구 등록됨`);
    }

    /**
     * 등록된 도구 수 조회
     */

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

    // (제거됨) executeTool() — sanitize 검증 없이 server.handleRequest('tools/call') 를 호출하던
    //   미사용 경로. canonical 은 executeToolWithContext (sandbox·인자 sanitize 적용).
    // (제거됨) handleMCPRequest() — 미구현 SSE 핸들러용 dead code. 네트워크로 MCP 를 노출하려면
    //   handleRequest 진입점에 UserContext 존재 검증을 먼저 강제할 것.

    /**
     * 상태 초기화
     */
    reset(): void {
        logger.info('상태 초기화 완료');
    }

    /**
     * 통계 조회
     */
    getStats(): { tools: number } {
        return {
            tools: this.getToolCount()
        };
    }

    // ============================================
    // 도구 목록 조회
    // ============================================

    /**
     * 사용자 컨텍스트로 도구 실행 — 경로 샌드박스·인자 검증·감사는 Base 가드
     * (`tool-contract/tool-execution-guard`)가, 실제 라우팅은 ToolRouter 가 맡는다.
     *
     * toolRouter 직접 호출 — JSON-RPC 래퍼는 context 채널이 없어 사용자 스코프 내장 도구
     * (agent_task_* 등)와 user-pool 외부 도구에 userId 가 전달되지 않는다.
     */
    async executeToolWithContext(
        toolName: string,
        args: Record<string, unknown>,
        context: UserContext
    ): Promise<MCPToolResult> {
        return executeToolSecurely(
            (name, sandboxedArgs, ctx) => this.toolRouter.executeTool(name, sandboxedArgs, ctx),
            toolName, args, context,
        );
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

