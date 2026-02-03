/**
 * ChatService Tests
 * Basic tests for chat service types and interfaces
 */
import { ChatHistoryMessage, AgentSelectionInfo, ToolCallInfo, WebSearchResult } from '../services/ChatService';

describe('ChatService Types', () => {
    describe('ChatHistoryMessage', () => {
        it('should allow valid user message', () => {
            const msg: ChatHistoryMessage = {
                role: 'user',
                content: 'Hello world'
            };
            expect(msg.role).toBe('user');
            expect(msg.content).toBe('Hello world');
        });

        it('should allow assistant message with tool_calls', () => {
            const msg: ChatHistoryMessage = {
                role: 'assistant',
                content: '',
                tool_calls: [{
                    type: 'function',
                    function: {
                        name: 'test_tool',
                        arguments: { arg1: 'value' }
                    }
                }]
            };
            expect(msg.tool_calls).toHaveLength(1);
            expect(msg.tool_calls![0].function.name).toBe('test_tool');
        });

        it('should allow message with images', () => {
            const msg: ChatHistoryMessage = {
                role: 'user',
                content: 'Check this image',
                images: ['base64data']
            };
            expect(msg.images).toHaveLength(1);
        });

        it('should allow system message', () => {
            const msg: ChatHistoryMessage = {
                role: 'system',
                content: 'You are a helpful assistant'
            };
            expect(msg.role).toBe('system');
            expect(msg.content).toBe('You are a helpful assistant');
        });

        it('should allow tool message', () => {
            const msg: ChatHistoryMessage = {
                role: 'tool',
                content: 'Tool result'
            };
            expect(msg.role).toBe('tool');
            expect(msg.content).toBe('Tool result');
        });

        it('should allow message with multiple images', () => {
            const msg: ChatHistoryMessage = {
                role: 'user',
                content: 'Compare these images',
                images: ['image1', 'image2', 'image3']
            };
            expect(msg.images).toHaveLength(3);
        });

        it('should allow message with string arguments in tool_calls', () => {
            const msg: ChatHistoryMessage = {
                role: 'assistant',
                content: '',
                tool_calls: [{
                    type: 'function',
                    function: {
                        name: 'search',
                        arguments: '{"query": "test"}'
                    }
                }]
            };
            expect(typeof msg.tool_calls![0].function.arguments).toBe('string');
        });

        it('should allow additional properties via index signature', () => {
            const msg: ChatHistoryMessage = {
                role: 'user',
                content: 'Test',
                customField: 'custom value',
                anotherField: 123
            };
            expect((msg as any).customField).toBe('custom value');
            expect((msg as any).anotherField).toBe(123);
        });
    });

    describe('AgentSelectionInfo', () => {
        it('should represent agent selection', () => {
            const info: AgentSelectionInfo = {
                type: 'code_expert',
                name: 'Code Expert',
                emoji: '👨‍💻',
                confidence: 0.95,
                reason: 'Code-related query detected'
            };
            expect(info.type).toBe('code_expert');
            expect(info.confidence).toBe(0.95);
        });

        it('should allow partial agent selection info', () => {
            const info: AgentSelectionInfo = {
                type: 'researcher'
            };
            expect(info.type).toBe('researcher');
            expect(info.name).toBeUndefined();
        });

        it('should allow phase property', () => {
            const info: AgentSelectionInfo = {
                type: 'agent',
                phase: 'analysis'
            };
            expect(info.phase).toBe('analysis');
        });

        it('should allow additional properties', () => {
            const info: AgentSelectionInfo = {
                type: 'expert',
                customProp: 'value'
            };
            expect((info as any).customProp).toBe('value');
        });
    });

    describe('ToolCallInfo', () => {
        it('should represent tool call structure', () => {
            const tool: ToolCallInfo = {
                type: 'function',
                function: {
                    name: 'web_search',
                    arguments: { query: 'test query' }
                }
            };
            expect(tool.function.name).toBe('web_search');
        });

        it('should allow tool call without type', () => {
            const tool: ToolCallInfo = {
                function: {
                    name: 'calculator',
                    arguments: { operation: 'add', a: 1, b: 2 }
                }
            };
            expect(tool.function.name).toBe('calculator');
            expect((tool.function.arguments as any).a).toBe(1);
        });

        it('should handle complex arguments', () => {
            const tool: ToolCallInfo = {
                type: 'function',
                function: {
                    name: 'complex_tool',
                    arguments: {
                        nested: { deep: { value: 'test' } },
                        array: [1, 2, 3],
                        string: 'value'
                    }
                }
            };
            expect((tool.function.arguments as any).nested.deep.value).toBe('test');
            expect((tool.function.arguments as any).array).toHaveLength(3);
        });
    });

    describe('WebSearchResult', () => {
        it('should represent search result', () => {
            const result: WebSearchResult = {
                title: 'Test Page',
                url: 'https://example.com',
                snippet: 'A test snippet'
            };
            expect(result.title).toBe('Test Page');
            expect(result.url).toBe('https://example.com');
        });

        it('should allow result without snippet', () => {
            const result: WebSearchResult = {
                title: 'Another Page',
                url: 'https://another.com'
            };
            expect(result.title).toBe('Another Page');
            expect(result.snippet).toBeUndefined();
        });

        it('should handle URLs with query parameters', () => {
            const result: WebSearchResult = {
                title: 'Search Results',
                url: 'https://example.com/search?q=test&lang=en',
                snippet: 'Results for test'
            };
            expect(result.url).toContain('?q=test');
        });

        it('should handle long snippets', () => {
            const longSnippet = 'A'.repeat(500);
            const result: WebSearchResult = {
                title: 'Long Result',
                url: 'https://example.com',
                snippet: longSnippet
            };
            expect(result.snippet).toHaveLength(500);
        });
    });

    describe('Type Compatibility', () => {
        it('should allow ChatHistoryMessage array', () => {
            const messages: ChatHistoryMessage[] = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there' }
            ];
            expect(messages).toHaveLength(2);
            expect(messages[0].role).toBe('user');
        });

        it('should allow WebSearchResult array', () => {
            const results: WebSearchResult[] = [
                { title: 'Result 1', url: 'https://example1.com' },
                { title: 'Result 2', url: 'https://example2.com', snippet: 'Snippet' }
            ];
            expect(results).toHaveLength(2);
        });

        it('should allow mixed tool_calls in messages', () => {
            const messages: ChatHistoryMessage[] = [
                {
                    role: 'assistant',
                    content: 'I will search',
                    tool_calls: [
                        {
                            type: 'function',
                            function: { name: 'search', arguments: { query: 'test' } }
                        }
                    ]
                },
                {
                    role: 'tool',
                    content: 'Search results'
                }
            ];
            expect(messages).toHaveLength(2);
            expect(messages[0].tool_calls).toBeDefined();
        });
    });
});
