/**
 * Ollama Agent Loop 유닛 테스트
 */

import {
    runAgentLoop,
    executeSingleToolCall,
    mcpToolToOllamaTool,
    mcpToolsToOllamaTools,
    AgentLoopOptions,
    AgentLoopResult
} from '../../../backend/api/src/ollama/agent-loop';
import { ToolDefinition, ChatMessage } from '../../../backend/api/src/ollama/types';

// Mock Tools
const addTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'add',
        description: 'Add two numbers',
        parameters: {
            type: 'object',
            properties: {
                a: { type: 'integer', description: 'First number' },
                b: { type: 'integer', description: 'Second number' }
            },
            required: ['a', 'b']
        }
    }
};

const multiplyTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'multiply',
        description: 'Multiply two numbers',
        parameters: {
            type: 'object',
            properties: {
                a: { type: 'integer', description: 'First number' },
                b: { type: 'integer', description: 'Second number' }
            },
            required: ['a', 'b']
        }
    }
};

// Mock Functions
const availableFunctions = {
    add: (args: { a: number; b: number }) => args.a + args.b,
    multiply: (args: { a: number; b: number }) => args.a * args.b
};

describe('Ollama Agent Loop', () => {
    describe('mcpToolToOllamaTool', () => {
        it('should convert MCP tool to Ollama tool format', () => {
            const mcpTool = {
                tool: {
                    name: 'test_tool',
                    description: 'A test tool',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            input: { type: 'string', description: 'Input value' }
                        },
                        required: ['input']
                    }
                }
            };

            const result = mcpToolToOllamaTool(mcpTool);

            expect(result.type).toBe('function');
            expect(result.function.name).toBe('test_tool');
            expect(result.function.description).toBe('A test tool');
            expect(result.function.parameters).toEqual(mcpTool.tool.inputSchema);
        });
    });

    describe('mcpToolsToOllamaTools', () => {
        it('should convert multiple MCP tools', () => {
            const mcpTools = [
                {
                    tool: {
                        name: 'tool1',
                        description: 'Tool 1',
                        inputSchema: { type: 'object', properties: {} }
                    }
                },
                {
                    tool: {
                        name: 'tool2',
                        description: 'Tool 2',
                        inputSchema: { type: 'object', properties: {} }
                    }
                }
            ];

            const result = mcpToolsToOllamaTools(mcpTools);

            expect(result).toHaveLength(2);
            expect(result[0].function.name).toBe('tool1');
            expect(result[1].function.name).toBe('tool2');
        });
    });

    // Note: 아래 테스트는 실제 Ollama 서버가 필요하므로 integration test로 분류해야 합니다.
    // 여기서는 구조 테스트만 수행합니다.

    describe('AgentLoopOptions interface', () => {
        it('should accept valid options', () => {
            const options: AgentLoopOptions = {
                model: 'gemini-3-flash-preview:cloud',
                messages: [{ role: 'user', content: 'Test' }],
                tools: [addTool, multiplyTool],
                availableFunctions,
                think: true,
                stream: false,
                maxIterations: 5
            };

            expect(options.model).toBe('gemini-3-flash-preview:cloud');
            expect(options.tools).toHaveLength(2);
            expect(options.maxIterations).toBe(5);
        });

        it('should have default values for optional fields', () => {
            const options: AgentLoopOptions = {
                messages: [{ role: 'user', content: 'Test' }],
                tools: [],
                availableFunctions: {}
            };

            expect(options.model).toBeUndefined();
            expect(options.think).toBeUndefined();
            expect(options.stream).toBeUndefined();
            expect(options.maxIterations).toBeUndefined();
        });
    });

    describe('Tool Definitions', () => {
        it('should have correct structure for add tool', () => {
            expect(addTool.type).toBe('function');
            expect(addTool.function.name).toBe('add');
            expect(addTool.function.parameters.required).toContain('a');
            expect(addTool.function.parameters.required).toContain('b');
        });

        it('should have correct structure for multiply tool', () => {
            expect(multiplyTool.type).toBe('function');
            expect(multiplyTool.function.name).toBe('multiply');
        });
    });

    describe('Available Functions', () => {
        it('should correctly execute add function', () => {
            const result = availableFunctions.add({ a: 5, b: 3 });
            expect(result).toBe(8);
        });

        it('should correctly execute multiply function', () => {
            const result = availableFunctions.multiply({ a: 4, b: 7 });
            expect(result).toBe(28);
        });
    });
});
