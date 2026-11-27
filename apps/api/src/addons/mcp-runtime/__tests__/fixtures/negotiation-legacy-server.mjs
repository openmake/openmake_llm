/**
 * MCP-2 테스트 fixture — 구 방식(2025 initialize)만 말하는 stdio 서버.
 * 기본은 공식 v1 SDK McpServer. NEGOTIATION_FIXTURE_SILENT=1 이면 손으로 만든 서버가 initialize·tools/list 외의
 * 요청(server/discover 포함)에 아예 답하지 않는다(조용한 구 서버 — 탐지 타임아웃 경로).
 * NEGOTIATION_FIXTURE_LOG 가 있으면 뜰 때마다 'spawn' 한 줄을 남긴다(탐지용 형제 프로세스 수를 세려고).
 */
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const log = process.env.NEGOTIATION_FIXTURE_LOG;
if (log) appendFileSync(log, 'spawn\n');

if (process.env.NEGOTIATION_FIXTURE_SILENT === '1') {
    const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
    createInterface({ input: process.stdin }).on('line', (line) => {
        let m;
        try { m = JSON.parse(line); } catch { return; }
        if (m.id === undefined) return;
        if (m.method === 'initialize') {
            send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'silent-legacy', version: '0.1.0' } } });
        } else if (m.method === 'tools/list') {
            send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } });
        }
    });
} else {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const server = new McpServer({ name: 'legacy-fixture', version: '1.0.0' });
    server.tool('echo', async () => ({ content: [{ type: 'text', text: 'legacy' }] }));
    await server.connect(new StdioServerTransport());
}
