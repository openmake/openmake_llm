/**
 * Tool Tiers Tests
 * MCP 도구 등급별 접근 제어 테스트
 */

import { canUseTool, getToolsForTier, getDefaultTierForRole, TOOL_TIERS } from '../tool-tiers';

describe('Tool Tiers', () => {
    describe('TOOL_TIERS', () => {
        it('should define free tier with limited tools', () => {
            expect(TOOL_TIERS.free).toContain('web_search');
            expect(TOOL_TIERS.free).toContain('vision_ocr');
            expect(TOOL_TIERS.free).toContain('analyze_image');
            expect(TOOL_TIERS.free).not.toContain('run_command');
        });

        it('should define pro tier with more tools', () => {
            expect(TOOL_TIERS.pro).toContain('web_search');
            expect(TOOL_TIERS.pro).toContain('run_command');
            expect(TOOL_TIERS.pro).toContain('firecrawl_*');
            expect(TOOL_TIERS.pro).toContain('sequential_thinking');
        });

        it('should define enterprise tier with wildcard', () => {
            expect(TOOL_TIERS.enterprise).toContain('*');
        });
    });

    describe('canUseTool', () => {
        describe('free tier', () => {
            it('should allow web_search', () => {
                expect(canUseTool('free', 'web_search')).toBe(true);
            });

            it('should allow vision_ocr', () => {
                expect(canUseTool('free', 'vision_ocr')).toBe(true);
            });

            it('should allow analyze_image', () => {
                expect(canUseTool('free', 'analyze_image')).toBe(true);
            });

            it('should deny run_command', () => {
                expect(canUseTool('free', 'run_command')).toBe(false);
            });

            it('should deny firecrawl tools', () => {
                expect(canUseTool('free', 'firecrawl_scrape')).toBe(false);
            });

            it('should deny external tools (with namespace)', () => {
                expect(canUseTool('free', 'postgres::query')).toBe(false);
            });
        });

        describe('pro tier', () => {
            it('should allow free tier tools', () => {
                expect(canUseTool('pro', 'web_search')).toBe(true);
                expect(canUseTool('pro', 'vision_ocr')).toBe(true);
            });

            it('should allow run_command', () => {
                expect(canUseTool('pro', 'run_command')).toBe(true);
            });

            it('should allow firecrawl tools via wildcard', () => {
                expect(canUseTool('pro', 'firecrawl_scrape')).toBe(true);
                expect(canUseTool('pro', 'firecrawl_search')).toBe(true);
            });

            it('should allow sequential_thinking', () => {
                expect(canUseTool('pro', 'sequential_thinking')).toBe(true);
            });

            it('should allow external tools by default', () => {
                // pro tier allows all external tools by default
                expect(canUseTool('pro', 'postgres::query')).toBe(true);
                expect(canUseTool('pro', 'redis::get')).toBe(true);
            });
        });

        describe('enterprise tier', () => {
            it('should allow all tools via wildcard', () => {
                expect(canUseTool('enterprise', 'web_search')).toBe(true);
                expect(canUseTool('enterprise', 'run_command')).toBe(true);
                expect(canUseTool('enterprise', 'any_tool')).toBe(true);
                expect(canUseTool('enterprise', 'postgres::query')).toBe(true);
            });
        });
    });

    describe('getToolsForTier', () => {
        const allTools = [
            'web_search',
            'vision_ocr',
            'analyze_image',
            'run_command',
            'firecrawl_scrape',
            'sequential_thinking',
            'postgres::query'
        ];

        it('should filter tools for free tier', () => {
            const tools = getToolsForTier('free', allTools);
            
            expect(tools).toContain('web_search');
            expect(tools).toContain('vision_ocr');
            expect(tools).toContain('analyze_image');
            expect(tools).not.toContain('run_command');
            expect(tools).not.toContain('firecrawl_scrape');
            expect(tools).not.toContain('postgres::query');
        });

        it('should filter tools for pro tier', () => {
            const tools = getToolsForTier('pro', allTools);
            
            expect(tools).toContain('web_search');
            expect(tools).toContain('run_command');
            expect(tools).toContain('firecrawl_scrape');
            expect(tools).toContain('sequential_thinking');
            expect(tools).toContain('postgres::query');
        });

        it('should return all tools for enterprise tier', () => {
            const tools = getToolsForTier('enterprise', allTools);
            
            expect(tools).toEqual(allTools);
        });
    });

    describe('getDefaultTierForRole', () => {
        it('should return enterprise for admin role', () => {
            expect(getDefaultTierForRole('admin')).toBe('enterprise');
        });

        it('should return free for user role', () => {
            expect(getDefaultTierForRole('user')).toBe('free');
        });

        it('should return free for guest role', () => {
            expect(getDefaultTierForRole('guest')).toBe('free');
        });
    });
});
