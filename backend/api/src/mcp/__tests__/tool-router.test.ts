/**
 * ToolRouter Unit Tests
 */

import { ToolRouter } from '../tool-router';
import type { MCPTool, MCPToolResult } from '../types';
import { MCP_NAMESPACE_SEPARATOR } from '../types';

describe('ToolRouter', () => {
    let router: ToolRouter;

    beforeEach(() => {
        router = new ToolRouter();
    });

    describe('getAllTools', () => {
        it('should include built-in tools', () => {
            const tools = router.getAllTools();
            expect(tools.length).toBeGreaterThan(0);

            // 🔒 보안 패치 2026-02-07: run_command 제거됨 — vision_ocr가 남아있어야 함
            const visionOcr = tools.find(t => t.name === 'vision_ocr');
            expect(visionOcr).toBeDefined();
            // run_command는 보안상 제거되어 존재하지 않아야 함
            const runCommand = tools.find(t => t.name === 'run_command');
            expect(runCommand).toBeUndefined();
        });

        it('should include external tools after registration', () => {
            const mockTool: MCPTool = {
                name: 'list_tables',
                description: 'List database tables',
                inputSchema: { type: 'object', properties: {}, required: [] }
            };

            const mockExecutor = async (_name: string, _args: Record<string, unknown>): Promise<MCPToolResult> => ({
                content: [{ type: 'text', text: 'ok' }]
            });

            router.registerExternalTools('server1', 'postgres', [mockTool], mockExecutor);

            const tools = router.getAllTools();
            const external = tools.find(t => t.name === `postgres${MCP_NAMESPACE_SEPARATOR}list_tables`);
            expect(external).toBeDefined();
            expect(external!.description).toBe('List database tables');
        });
    });

    describe('getToolsForTier', () => {
        it('should filter tools for free tier', () => {
            const tools = router.getToolsForTier('free');
            // free tier has web_search, vision_ocr, analyze_image
            const names = tools.map(t => t.name);
            expect(names).toContain('web_search');
        });

        it('should exclude external tools for free tier', () => {
            const mockTool: MCPTool = {
                name: 'query',
                description: 'Run SQL',
                inputSchema: { type: 'object', properties: {}, required: [] }
            };

            router.registerExternalTools('s1', 'db', [mockTool], async () => ({
                content: [{ type: 'text', text: 'ok' }]
            }));

            const freeTools = router.getToolsForTier('free');
            const hasExternal = freeTools.some(t => t.name.includes(MCP_NAMESPACE_SEPARATOR));
            expect(hasExternal).toBe(false);
        });

        it('should include external tools for enterprise tier', () => {
            const mockTool: MCPTool = {
                name: 'query',
                description: 'Run SQL',
                inputSchema: { type: 'object', properties: {}, required: [] }
            };

            router.registerExternalTools('s1', 'db', [mockTool], async () => ({
                content: [{ type: 'text', text: 'ok' }]
            }));

            const entTools = router.getToolsForTier('enterprise');
            const external = entTools.find(t => t.name === `db${MCP_NAMESPACE_SEPARATOR}query`);
            expect(external).toBeDefined();
        });
    });

    describe('executeTool', () => {
        it('should execute a built-in tool', async () => {
            // run_command is a built-in tool
            const result = await router.executeTool('run_command', { command: 'echo hello' });
            expect(result).toBeDefined();
            expect(result.content).toBeDefined();
            expect(result.content.length).toBeGreaterThan(0);
        });

        it('should execute an external tool', async () => {
            const mockTool: MCPTool = {
                name: 'ping',
                description: 'Ping service',
                inputSchema: { type: 'object', properties: {}, required: [] }
            };

            const mockExecutor = async (name: string, _args: Record<string, unknown>): Promise<MCPToolResult> => ({
                content: [{ type: 'text', text: `pong from ${name}` }]
            });

            router.registerExternalTools('srv1', 'myserver', [mockTool], mockExecutor);

            const result = await router.executeTool(`myserver${MCP_NAMESPACE_SEPARATOR}ping`, {});
            expect(result.isError).toBeFalsy();
            expect(result.content[0].text).toBe('pong from ping');
        });

        it('should return error for unknown tool', async () => {
            const result = await router.executeTool('nonexistent_tool', {});
            expect(result.isError).toBe(true);
        });

        it('should return error for unknown external tool', async () => {
            const result = await router.executeTool(`unknown${MCP_NAMESPACE_SEPARATOR}tool`, {});
            expect(result.isError).toBe(true);
        });
    });

    describe('registerExternalTools / unregisterExternalTools', () => {
        it('should register and count external tools', () => {
            const tools: MCPTool[] = [
                { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {}, required: [] } },
                { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {}, required: [] } },
            ];

            router.registerExternalTools('s1', 'ext', tools, async () => ({
                content: [{ type: 'text', text: 'ok' }]
            }));

            expect(router.getExternalToolCount()).toBe(2);
        });

        it('should unregister tools by serverId', () => {
            const tools: MCPTool[] = [
                { name: 'x', description: 'X', inputSchema: { type: 'object', properties: {}, required: [] } },
            ];

            router.registerExternalTools('s1', 'ext', tools, async () => ({
                content: [{ type: 'text', text: 'ok' }]
            }));

            expect(router.getExternalToolCount()).toBe(1);

            router.unregisterExternalTools('s1');
            expect(router.getExternalToolCount()).toBe(0);
        });

        it('should replace tools on re-registration', () => {
            const executor = async (): Promise<MCPToolResult> => ({
                content: [{ type: 'text', text: 'ok' }]
            });

            router.registerExternalTools('s1', 'ext', [
                { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {}, required: [] } },
                { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {}, required: [] } },
            ], executor);

            expect(router.getExternalToolCount()).toBe(2);

            // Re-register with different tools
            router.registerExternalTools('s1', 'ext', [
                { name: 'c', description: 'C', inputSchema: { type: 'object', properties: {}, required: [] } },
            ], executor);

            expect(router.getExternalToolCount()).toBe(1);
        });
    });

    describe('getOllamaTools', () => {
        it('should return Ollama-compatible format', () => {
            const tools = router.getOllamaTools('enterprise');
            expect(tools.length).toBeGreaterThan(0);

            const first = tools[0];
            expect(first.type).toBe('function');
            expect(first.function).toBeDefined();
            expect(first.function.name).toBeDefined();
            expect(first.function.description).toBeDefined();
            expect(first.function.parameters).toBeDefined();
        });
    });

    describe('isExternalTool', () => {
        it('should identify external tools by namespace separator', () => {
            expect(router.isExternalTool(`server${MCP_NAMESPACE_SEPARATOR}tool`)).toBe(true);
            expect(router.isExternalTool('run_command')).toBe(false);
        });
    });
});
