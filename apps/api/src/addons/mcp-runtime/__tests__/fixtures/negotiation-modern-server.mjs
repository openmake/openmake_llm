/**
 * MCP-2 테스트 fixture — 2026-07-28(server/discover)만 말하는 손으로 만든 stdio 서버(initialize 는 -32601).
 * NEGOTIATION_FIXTURE_LOG 가 있으면 뜰 때 'spawn', server/discover 를 받을 때 'discover' 를 남긴다.
 */
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const log = process.env.NEGOTIATION_FIXTURE_LOG;
const mark = (s) => { if (log) appendFileSync(log, s + '\n'); };
mark('spawn');

const cacheHint = { ttlMs: 0, cacheScope: 'private' };
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return;
    if (m.method === 'server/discover') {
        mark('discover');
        send({ jsonrpc: '2.0', id: m.id, result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, serverInfo: { name: 'modern-fixture', version: '2.0.0' }, resultType: 'complete', ...cacheHint } });
    } else if (m.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }], resultType: 'complete', ...cacheHint } });
    } else if (m.method === 'tools/call') {
        send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'modern' }], resultType: 'complete' } });
    } else {
        send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    }
});
