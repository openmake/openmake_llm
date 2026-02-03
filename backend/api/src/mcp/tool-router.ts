/**
 * ToolRouter — 통합 도구 레지스트리
 * 내장 도구(builtInTools)와 외부 MCP 서버 도구를 하나의 인터페이스로 통합합니다.
 */

import type { MCPTool, MCPToolResult, ExternalToolEntry } from './types';
import { MCP_NAMESPACE_SEPARATOR } from './types';
import type { MCPToolDefinition } from './types';
import { builtInTools } from './tools';
import type { UserTier } from '../data/user-manager';
import { canUseTool } from './tool-tiers';

/** 외부 도구 실행기 함수 타입 */
type ExternalToolExecutor = (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>;

/** Ollama 호환 도구 형식 */
interface OllamaTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: Record<string, unknown>;
            required?: string[];
        };
    };
}

export class ToolRouter {
    /** 외부 도구 레지스트리: namespacedName → ExternalToolEntry */
    private externalTools: Map<string, ExternalToolEntry> = new Map();

    /** 외부 도구 실행기: serverId → executor function */
    private externalExecutors: Map<string, ExternalToolExecutor> = new Map();

    /** 모든 도구(내장+외부) MCPTool 목록 반환 */
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

    /** 사용자 등급별 필터링된 도구 목록 */
    getToolsForTier(tier: UserTier): MCPTool[] {
        return this.getAllTools().filter(tool => canUseTool(tier, tool.name));
    }

    /** 도구 실행 — 내장이면 직접 handler, 외부면 ExternalMCPClient로 라우팅 */
    async executeTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
        // 1. 외부 도구 확인 (:: 네임스페이스)
        if (name.includes(MCP_NAMESPACE_SEPARATOR)) {
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

            // 외부 서버에는 원본 이름으로 호출
            return executor(externalEntry.originalName, args);
        }

        // 2. 내장 도구 확인
        const builtIn = builtInTools.find((def: MCPToolDefinition) => def.tool.name === name);
        if (builtIn) {
            try {
                return await builtIn.handler(args);
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

    /** Ollama 호환 도구 형식으로 변환 */
    getOllamaTools(tier: UserTier): OllamaTool[] {
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

    /** 외부 서버의 도구 일괄 등록 */
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

        console.log(`[ToolRouter] Registered ${tools.length} tools from "${serverName}" (serverId: ${serverId})`);
    }

    /** 외부 서버의 도구 일괄 해제 */
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
            console.log(`[ToolRouter] Unregistered ${keysToRemove.length} tools for serverId: ${serverId}`);
        }
    }

    /** 등록된 외부 도구 수 */
    getExternalToolCount(): number {
        return this.externalTools.size;
    }

    /** 내장 도구 수 */
    getBuiltInToolCount(): number {
        return builtInTools.length;
    }

    /** 특정 도구가 외부 도구인지 확인 */
    isExternalTool(name: string): boolean {
        return name.includes(MCP_NAMESPACE_SEPARATOR);
    }
}
