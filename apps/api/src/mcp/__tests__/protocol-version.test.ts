/**
 * MCP initialize 프로토콜 리비전 협상 회귀 테스트.
 *
 * 종전 `mcp/server.ts` 는 `protocolVersion: '2024-11-05'` 고정 문자열을 돌려줬다 —
 * 클라이언트가 요청한 리비전을 보지 않아 최신 클라이언트도 2024 리비전으로 협상됐다.
 * 이 테스트는 그 회귀(고정 문자열 복귀)를 잡는다.
 */
import { MCPServer } from '../server';
import {
    MCP_DEFAULT_PROTOCOL_VERSION,
    MCP_SUPPORTED_PROTOCOL_VERSIONS,
    negotiateProtocolVersion,
} from '../../config/mcp-protocol';

describe('negotiateProtocolVersion', () => {
    it('지원 리비전을 요청하면 그대로 돌려준다', () => {
        MCP_SUPPORTED_PROTOCOL_VERSIONS.forEach((v) => {
            expect(negotiateProtocolVersion(v)).toBe(v);
        });
    });

    it('모르는 리비전·누락은 우리 최신으로 떨어진다', () => {
        expect(negotiateProtocolVersion('1999-01-01')).toBe(MCP_DEFAULT_PROTOCOL_VERSION);
        expect(negotiateProtocolVersion(undefined)).toBe(MCP_DEFAULT_PROTOCOL_VERSION);
        expect(negotiateProtocolVersion(42)).toBe(MCP_DEFAULT_PROTOCOL_VERSION);
    });

    it('최신 기본값은 2024 리비전이 아니다', () => {
        expect(MCP_DEFAULT_PROTOCOL_VERSION).toBe('2025-11-25');
    });

    it('구현하지 않은 modern era(2026-07-28)는 광고하지 않는다', () => {
        expect(MCP_SUPPORTED_PROTOCOL_VERSIONS).not.toContain('2026-07-28');
        expect(negotiateProtocolVersion('2026-07-28')).toBe(MCP_DEFAULT_PROTOCOL_VERSION);
    });
});

describe('MCPServer initialize', () => {
    const server = new MCPServer('openmake-test', '1.0.0');

    it('클라이언트가 요청한 최신 리비전을 그대로 협상한다', async () => {
        const res = await server.handleRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-11-25' },
        });
        expect((res.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
    });

    it('구 클라이언트(2024-11-05)와도 그 리비전으로 협상한다', async () => {
        const res = await server.handleRequest({
            jsonrpc: '2.0',
            id: 2,
            method: 'initialize',
            params: { protocolVersion: '2024-11-05' },
        });
        expect((res.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05');
    });

    it('버전 미지정이면 우리 최신 리비전을 돌려준다', async () => {
        const res = await server.handleRequest({ jsonrpc: '2.0', id: 3, method: 'initialize' });
        expect((res.result as { protocolVersion: string }).protocolVersion).toBe(MCP_DEFAULT_PROTOCOL_VERSION);
    });
});
