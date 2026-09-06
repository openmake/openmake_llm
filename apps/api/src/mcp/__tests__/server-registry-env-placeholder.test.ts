/**
 * 전역 registry 경로(부팅 initializeFromDB·수동 connect)도 `{{env.KEY}}` 자리표시자를 sh 변수 참조로
 * 감싼다 — 유저풀(lifecycle-supervisor)만 감싸고 전역은 리터럴이 argv 로 내려가던 갭(2026-09-06).
 */
const clientCtor = jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    getTools: jest.fn().mockReturnValue([]),
    disconnect: jest.fn().mockResolvedValue(undefined),
    callTool: jest.fn(),
}));
jest.mock('../external-client', () => ({ ExternalMCPClient: clientCtor }));

import { MCPServerRegistry } from '../server-registry';
import type { MCPServerConfig } from '../types';

const base = (over: Partial<MCPServerConfig>): MCPServerConfig => ({
    id: 'srv1', name: 'pg', transport_type: 'stdio', enabled: true,
    created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
} as MCPServerConfig);

describe('MCPServerRegistry.connectServer — env 자리표시자 래핑', () => {
    const registry = new MCPServerRegistry({ registerExternalTools: jest.fn(), unregisterExternalTools: jest.fn() } as never);
    beforeEach(() => clientCtor.mockClear());

    it('{{env.DATABASE_URL}} 위치 인자는 값 대신 "$DATABASE_URL" 셸 참조로 spawn 된다', async () => {
        await registry.connectServer('srv1', base({
            command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', '{{env.DATABASE_URL}}'],
            env: { DATABASE_URL: 'postgres://u:secret@h/db' },
        }));
        const cfg = clientCtor.mock.calls[0][0] as MCPServerConfig;
        expect(cfg.command).toBe('sh');
        expect(cfg.args?.join(' ')).toContain('"$DATABASE_URL"');
        expect(JSON.stringify(cfg.args)).not.toContain('{{env.');
        expect(JSON.stringify(cfg.args)).not.toContain('secret');
    });

    it('자리표시자가 없으면 command/args 원본 그대로', async () => {
        await registry.connectServer('srv1', base({ command: 'npx', args: ['-y', 'pkg'] }));
        const cfg = clientCtor.mock.calls[0][0] as MCPServerConfig;
        expect(cfg.command).toBe('npx');
        expect(cfg.args).toEqual(['-y', 'pkg']);
    });
});
