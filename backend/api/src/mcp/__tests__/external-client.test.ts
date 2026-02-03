/**
 * ExternalMCPClient Unit Tests
 * SDK 연결은 모킹 — 구조 및 상태 관리 검증
 */

import { ExternalMCPClient } from '../external-client';
import type { MCPServerConfig } from '../types';

const makeConfig = (overrides?: Partial<MCPServerConfig>): MCPServerConfig => ({
    id: 'test-1',
    name: 'test-server',
    transport_type: 'stdio',
    command: 'echo',
    args: ['hello'],
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
});

describe('ExternalMCPClient', () => {
    describe('constructor', () => {
        it('should create client with config', () => {
            const config = makeConfig();
            const client = new ExternalMCPClient(config);

            expect(client).toBeDefined();
            expect(client.getConfig().name).toBe('test-server');
        });

        it('should start with disconnected status', () => {
            const client = new ExternalMCPClient(makeConfig());
            const status = client.getStatus();

            expect(status.status).toBe('disconnected');
            expect(status.toolCount).toBe(0);
            expect(status.serverId).toBe('test-1');
            expect(status.serverName).toBe('test-server');
        });
    });

    describe('getTools', () => {
        it('should return empty array when disconnected', () => {
            const client = new ExternalMCPClient(makeConfig());
            expect(client.getTools()).toEqual([]);
        });
    });

    describe('callTool (disconnected)', () => {
        it('should return error when not connected', async () => {
            const client = new ExternalMCPClient(makeConfig());
            const result = await client.callTool('test_tool', {});

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('연결되어 있지 않습니다');
        });
    });

    describe('ping (disconnected)', () => {
        it('should return false when not connected', async () => {
            const client = new ExternalMCPClient(makeConfig());
            const result = await client.ping();

            expect(result).toBe(false);
        });
    });

    describe('disconnect (already disconnected)', () => {
        it('should safely disconnect when already disconnected', async () => {
            const client = new ExternalMCPClient(makeConfig());
            // Should not throw
            await client.disconnect();
            expect(client.getStatus().status).toBe('disconnected');
        });
    });

    describe('connect with invalid config', () => {
        it('should throw for stdio without command', async () => {
            const client = new ExternalMCPClient(makeConfig({ command: undefined }));

            try {
                await client.connect();
                // Should not reach here
                expect(true).toBe(false);
            } catch (e) {
                expect(client.getStatus().status).toBe('error');
                expect(client.getStatus().error).toBeDefined();
            }
        });

        it('should throw for SSE without url', async () => {
            const client = new ExternalMCPClient(makeConfig({
                transport_type: 'sse',
                command: undefined,
                url: undefined,
            }));

            try {
                await client.connect();
                expect(true).toBe(false);
            } catch (e) {
                expect(client.getStatus().status).toBe('error');
            }
        });

        it('should throw for streamable-http without url', async () => {
            const client = new ExternalMCPClient(makeConfig({
                transport_type: 'streamable-http',
                command: undefined,
                url: undefined,
            }));

            try {
                await client.connect();
                expect(true).toBe(false);
            } catch (e) {
                expect(client.getStatus().status).toBe('error');
            }
        });
    });
});
