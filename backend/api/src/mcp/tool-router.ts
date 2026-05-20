/**
 * ============================================================
 * ToolRouter - 통합 도구 레지스트리 및 라우터
 * ============================================================
 *
 * 내장 도구(builtInTools)와 외부 MCP 서버 도구를 하나의 인터페이스로 통합합니다.
 * 도구 이름의 네임스페이스(::)를 기반으로 내장/외부 도구를 자동 라우팅합니다.
 *
 * @module mcp/tool-router
 * @description
 * - 내장 도구와 외부 MCP 서버 도구의 통합 검색/실행
 * - '::' 네임스페이스 기반 외부 도구 라우팅 (예: "postgres::query")
 * - UserTier 기반 도구 접근 제어 (tool-tiers.ts 연동)
 * - Ollama 호환 도구 형식 변환 (getOllamaTools)
 * - 외부 서버 도구의 동적 등록/해제
 *
 * @example
 * ```typescript
 * const router = new ToolRouter();
 * // 내장 도구 실행
 * const result = await router.executeTool('web_search', { query: 'hello' });
 * // 외부 도구 실행 (네임스페이스 기반 라우팅)
 * const extResult = await router.executeTool('postgres::query', { sql: 'SELECT 1' });
 * ```
 *
 * 라우팅 알고리즘:
 * 1. 도구 이름에 '::' 포함 여부 확인
 * 2. '::' 포함 → externalTools 맵에서 검색 → ExternalMCPClient로 원본 이름 호출
 * 3. '::' 미포함 → builtInTools 배열에서 검색 → 직접 handler 호출
 * 4. 양쪽 모두 미발견 → 에러 반환
 */

import type { MCPTool, MCPToolResult, ExternalToolEntry } from './types';
import { MCP_NAMESPACE_SEPARATOR } from './types';
import type { MCPToolDefinition } from './types';
import { builtInTools } from './tools';
import type { UserTier } from '../data/user-manager';
import { canUseTool } from './tool-tiers';
import type { UserContext } from './user-sandbox';
import { createLogger } from '../utils/logger';
import { MCP_EXTERNAL_TOOL_LIMITS } from '../config/timeouts';

const logger = createLogger('ToolRouter');

/**
 * 외부 도구 실행기 함수 타입
 *
 * ExternalMCPClient.callTool을 래핑한 함수입니다.
 * ToolRouter가 외부 서버에 도구 실행을 위임할 때 사용합니다.
 *
 * @param name - 원본 도구 이름 (네임스페이스 제외)
 * @param args - 도구 실행 인자
 * @returns 도구 실행 결과
 */
type ExternalToolExecutor = (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>;

/**
 * LLM Function Calling 도구 형식 (OpenAI 호환)
 *
 * vLLM/LiteLLM 의 chat.completions.create({ tools }) 가 요구하는 형식입니다.
 * MCPTool 을 이 형식으로 변환하여 LLM 에 전달합니다.
 *
 * @interface LLMTool
 */
interface LLMTool {
    /** 도구 타입 (항상 'function') */
    type: 'function';
    /** 도구 함수 정의 */
    function: {
        /** 도구 이름 */
        name: string;
        /** 도구 설명 */
        description: string;
        /** 입력 파라미터 스키마 */
        parameters: {
            /** 스키마 타입 */
            type: string;
            /** 파라미터 속성 정의 */
            properties: Record<string, unknown>;
            /** 필수 파라미터 목록 */
            required?: string[];
        };
    };
}

/**
 * 통합 도구 레지스트리 및 라우터
 *
 * 내장 도구와 외부 MCP 서버 도구를 하나의 인터페이스로 통합합니다.
 * UnifiedMCPClient에서 인스턴스를 생성하여 사용합니다.
 *
 * @class ToolRouter
 */
export class ToolRouter {
    /** 외부 도구 레지스트리: namespacedName("서버명::도구명") → ExternalToolEntry */
    private externalTools: Map<string, ExternalToolEntry> = new Map();

    /** 외부 도구 실행기: serverId → ExternalToolExecutor 함수 */
    private externalExecutors: Map<string, ExternalToolExecutor> = new Map();

    /**
     * 모든 도구(내장+외부) MCPTool 목록 반환
     *
     * 내장 도구는 원본 이름, 외부 도구는 네임스페이스 적용된 이름을 사용합니다.
     *
     * @returns 전체 도구 목록 (MCPTool 배열)
     */
    getAllTools(): MCPTool[] {
        const tools: MCPTool[] = [];

        // 내장 도구
        for (const def of builtInTools) {
            tools.push(def.tool);
        }

        // 외부 도구 (네임스페이스 적용된 이름 사용)
        for (const entry of this.externalTools.values()) {
            tools.push({
                ...entry.tool,
                name: entry.namespacedName,
            });
        }

        return tools;
    }

    /**
     * 사용자 등급별 필터링된 도구 목록
     *
     * canUseTool()을 사용하여 해당 tier에서 접근 가능한 도구만 반환합니다.
     *
     * @param tier - 사용자 등급 ('free' | 'pro' | 'enterprise')
     * @returns 해당 등급에서 사용 가능한 도구 목록
     */
    getToolsForTier(tier: UserTier): MCPTool[] {
        return this.getAllTools().filter(tool => canUseTool(tier, tool.name));
    }

    /**
     * 도구 실행 — 내장이면 직접 handler, 외부면 ExternalMCPClient로 라우팅
     * 
     * ⚙️ Phase 3: UserContext 전달 추가 (2026-02-07)
     * 내장 도구 handler에 context를 전달하여, 도구가 사용자 정보를 참조할 수 있도록 합니다.
     */
    async executeTool(name: string, args: Record<string, unknown>, context?: UserContext): Promise<MCPToolResult> {
        // 1. 외부 도구 확인 (:: 네임스페이스)
        if (name.includes(MCP_NAMESPACE_SEPARATOR)) {
            // 1a. 사용자별 풀 우선 검색 (Phase 7 LifecycleSupervisor 가 채운 인스턴스)
            //     context.userId 가 있으면 user_private/user_shared 서버는 사용자 풀에서만 접근.
            if (context?.userId) {
                const [serverId, toolName] = name.split(MCP_NAMESPACE_SEPARATOR, 2);
                if (serverId && toolName) {
                    const { getUserMCPPool } = await import('./user-pool');
                    const userClient = getUserMCPPool().get(String(context.userId), serverId);
                    if (userClient) {
                        try {
                            return await Promise.race([
                                userClient.callTool(toolName, args),
                                new Promise<never>((_, reject) =>
                                    setTimeout(() => reject(new Error(`외부 도구 타임아웃: ${name}`)), MCP_EXTERNAL_TOOL_LIMITS.EXECUTION_TIMEOUT_MS)
                                ),
                            ]);
                        } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);
                            return { content: [{ type: 'text', text: `사용자 풀 도구 실행 실패 (${name}): ${msg}` }], isError: true };
                        }
                    }
                }
            }

            // 1b. 전역 externalTools (visibility=global) fallback
            const externalEntry = this.externalTools.get(name);
            if (!externalEntry) {
                return {
                    content: [{ type: 'text', text: `외부 도구를 찾을 수 없습니다: ${name}` }],
                    isError: true,
                };
            }

            const executor = this.externalExecutors.get(externalEntry.serverId);
            if (!executor) {
                return {
                    content: [{ type: 'text', text: `서버 "${externalEntry.serverName}"의 실행기를 찾을 수 없습니다.` }],
                    isError: true,
                };
            }

            // 외부 도구 실행 (타임아웃 + 출력 크기 제한 적용)
            try {
                const result = await Promise.race([
                    executor(externalEntry.originalName, args),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error(`외부 도구 타임아웃: ${name} (${MCP_EXTERNAL_TOOL_LIMITS.EXECUTION_TIMEOUT_MS}ms 초과)`)), MCP_EXTERNAL_TOOL_LIMITS.EXECUTION_TIMEOUT_MS)
                    )
                ]);

                // 출력 크기 제한
                if (result.content) {
                    for (const item of result.content) {
                        if ('text' in item && typeof item.text === 'string' && item.text.length > MCP_EXTERNAL_TOOL_LIMITS.MAX_OUTPUT_SIZE) {
                            item.text = item.text.substring(0, MCP_EXTERNAL_TOOL_LIMITS.MAX_OUTPUT_SIZE) + '\n... (출력이 1MB를 초과하여 잘렸습니다)';
                        }
                    }
                }

                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : '외부 도구 실행 실패';
                return {
                    content: [{ type: 'text', text: message }],
                    isError: true,
                };
            }
        }

        // 2. 내장 도구 확인
        const builtIn = builtInTools.find((def: MCPToolDefinition) => def.tool.name === name);
        if (builtIn) {
            try {
                return await builtIn.handler(args, context);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text', text: `도구 실행 오류 (${name}): ${message}` }],
                    isError: true,
                };
            }
        }

        return {
            content: [{ type: 'text', text: `도구를 찾을 수 없습니다: ${name}` }],
            isError: true,
        };
    }

    /**
     * LLM Function Calling 도구 형식으로 변환 (OpenAI 호환)
     *
     * MCPTool 형식을 vLLM/LiteLLM chat.completions.create({ tools }) 가 요구하는
     * 형식으로 변환합니다. tier 에 따라 접근 가능한 도구만 포함됩니다.
     *
     * @param tier - 사용자 등급
     * @returns OpenAI 호환 tools 배열
     */
    getLLMTools(tier: UserTier): LLMTool[] {
        const tools = this.getToolsForTier(tier);
        return tools.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: tool.inputSchema.type,
                    properties: tool.inputSchema.properties,
                    required: tool.inputSchema.required,
                },
            },
        }));
    }

    /** @deprecated Use getLLMTools(). 호환 alias — P9 에서 제거 예정. */
    getOllamaTools(tier: UserTier): LLMTool[] {
        return this.getLLMTools(tier);
    }

    /**
     * 외부 서버의 도구 일괄 등록
     *
     * 기존에 동일 serverId로 등록된 도구가 있으면 먼저 해제한 후,
     * 새로운 도구를 네임스페이스("서버명::도구명") 형식으로 등록합니다.
     *
     * @param serverId - 서버 고유 ID
     * @param serverName - 서버 이름 (네임스페이스 접두사로 사용)
     * @param tools - 등록할 도구 목록
     * @param executor - 도구 실행기 함수 (ExternalMCPClient.callTool 래퍼)
     */
    registerExternalTools(
        serverId: string,
        serverName: string,
        tools: MCPTool[],
        executor: ExternalToolExecutor
    ): void {
        // 기존 도구 먼저 해제
        this.unregisterExternalTools(serverId);

        // 실행기 등록
        this.externalExecutors.set(serverId, executor);

        // 도구 등록 (네임스페이스 적용)
        for (const tool of tools) {
            const namespacedName = `${serverName}${MCP_NAMESPACE_SEPARATOR}${tool.name}`;
            const entry: ExternalToolEntry = {
                serverId,
                serverName,
                originalName: tool.name,
                namespacedName,
                tool,
            };
            this.externalTools.set(namespacedName, entry);
        }

        logger.info(`Registered ${tools.length} tools from "${serverName}" (serverId: ${serverId})`);
    }

    /**
     * 외부 서버의 도구 일괄 해제
     *
     * 해당 serverId에 속한 모든 도구를 externalTools 맵에서 제거하고,
     * 실행기도 externalExecutors 맵에서 삭제합니다.
     *
     * @param serverId - 해제할 서버 ID
     */
    unregisterExternalTools(serverId: string): void {
        const keysToRemove: string[] = [];
        for (const [key, entry] of this.externalTools) {
            if (entry.serverId === serverId) {
                keysToRemove.push(key);
            }
        }

        for (const key of keysToRemove) {
            this.externalTools.delete(key);
        }

        this.externalExecutors.delete(serverId);

        if (keysToRemove.length > 0) {
            logger.info(`Unregistered ${keysToRemove.length} tools for serverId: ${serverId}`);
        }
    }

    /**
     * 등록된 외부 도구 수
     *
     * @returns 현재 등록된 외부 도구의 총 수
     */
    getExternalToolCount(): number {
        return this.externalTools.size;
    }

    /**
     * 내장 도구 수
     *
     * @returns builtInTools 배열의 길이
     */
    getBuiltInToolCount(): number {
        return builtInTools.length;
    }

    /**
     * 특정 도구가 외부 도구인지 확인
     *
     * 도구 이름에 네임스페이스 구분자('::')가 포함되어 있는지 검사합니다.
     *
     * @param name - 확인할 도구 이름
     * @returns 외부 도구이면 true
     */
    isExternalTool(name: string): boolean {
        return name.includes(MCP_NAMESPACE_SEPARATOR);
    }
}
