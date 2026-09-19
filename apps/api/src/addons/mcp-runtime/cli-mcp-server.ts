/**
 * `openmake mcp` — OpenMake 를 MCP 서버로 노출하는 CLI 모드 (2026-09-19 add-on 으로 이동).
 * @module addons/mcp-runtime/cli-mcp-server
 */
import { createMCPServer } from './server';

export async function runMcpServerMode(version: string): Promise<void> {
    const server = createMCPServer('openmake-coder', version);
    await server.start();
}
