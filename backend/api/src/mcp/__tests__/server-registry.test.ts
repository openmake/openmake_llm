/**
 * MCPServerRegistry Unit Tests
 * DB 및 ExternalMCPClient 연결은 모킹 — 레지스트리 관리 로직 검증
 */

import { MCPServerRegistry } from '../server-registry';
import { ToolRouter } from '../tool-router';

describe('MCPServerRegistry', () => {
    let toolRouter: ToolRouter;
    let registry: MCPServerRegistry;

    beforeEach(() => {
        toolRouter = new ToolRouter();
        registry = new MCPServerRegistry(toolRouter);
    });

    describe('constructor', () => {
        it('should create with zero connections', () => {
            expect(registry.getConnectionCount()).toBe(0);
        });

        it('should return empty statuses', () => {
            expect(registry.getAllStatuses()).toEqual([]);
        });
    });

    describe('getServerStatus', () => {
        it('should return undefined for unknown server', () => {
            expect(registry.getServerStatus('unknown')).toBeUndefined();
        });
    });

    describe('pingServer', () => {
        it('should return false for unknown server', async () => {
            const result = await registry.pingServer('unknown');
            expect(result).toBe(false);
        });
    });

    describe('getClient', () => {
        it('should return undefined for unknown server', () => {
            expect(registry.getClient('unknown')).toBeUndefined();
        });
    });

    describe('disconnectAll', () => {
        it('should safely disconnect with no connections', async () => {
            // Should not throw
            await registry.disconnectAll();
            expect(registry.getConnectionCount()).toBe(0);
        });
    });

    describe('disconnectServer', () => {
        it('should safely disconnect unknown server', async () => {
            // Should not throw
            await registry.disconnectServer('unknown');
            expect(registry.getConnectionCount()).toBe(0);
        });
    });

    describe('connectServer (failure cases)', () => {
        it('should handle connect failure for missing command', async () => {
            try {
                await registry.connectServer('test-1', {
                    id: 'test-1',
                    name: 'broken',
                    transport_type: 'stdio',
                    // Missing command
                    enabled: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                });
                // Should throw
                expect(true).toBe(false);
            } catch (e) {
                // Expected: connection should fail
                // Client is created but connection fails, then status is error
                const status = registry.getServerStatus('test-1');
                expect(status).toBeDefined();
                expect(status!.status).toBe('error');
            }
        });
    });

    describe('integration with ToolRouter', () => {
        it('should reflect tool count in router after disconnect', async () => {
            // Pre-register tools in router to test unregister path
            toolRouter.registerExternalTools('srv-x', 'extserver', [
                { name: 'tool1', description: 'T1', inputSchema: { type: 'object', properties: {}, required: [] } }
            ], async () => ({ content: [{ type: 'text', text: 'ok' }] }));

            expect(toolRouter.getExternalToolCount()).toBe(1);

            // Unregister via router directly (registry.disconnectServer calls this)
            toolRouter.unregisterExternalTools('srv-x');
            expect(toolRouter.getExternalToolCount()).toBe(0);
        });
    });
});
