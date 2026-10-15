/**
 * MCP 런타임 진입점의 handle — stop 은 런타임 정리(외부 연결 해제·사용자 풀 종료)에 위임하고, resume 은 없다(재시작 필요).
 */
const shutdown = jest.fn(async () => undefined);
const startToolRuntime = jest.fn(async () => undefined);
const registerToolRuntime = jest.fn();
jest.mock('../runtime', () => ({ mcpToolRuntime: { shutdown: () => shutdown() } }));
jest.mock('../mcp-meta-tools', () => ({ mcpMetaTools: [] }));
jest.mock('../mcp-server-ingest-tool', () => ({
    importMcpServerFromGitTool: { tool: { name: 'import_mcp_server', description: 'x', inputSchema: { type: 'object', properties: {} } }, handler: async () => ({ content: [] }) },
}));
jest.mock('../runtime-boot', () => ({ startToolRuntime: () => startToolRuntime() }));
jest.mock('../../../runtime-ports/tool-runtime', () => ({ registerToolRuntime: (r: unknown) => registerToolRuntime(r) }));

import { startMcpRuntime } from '../boot';
import { isAddonRuntimeHandle } from '../../../addon-host/lifecycle-types';

beforeEach(() => { jest.clearAllMocks(); });

describe('startMcpRuntime handle', () => {
    it('handle 을 돌려주고, stop 은 mcpToolRuntime.shutdown 을 한 번 부른다', async () => {
        const handle = await startMcpRuntime();
        expect(isAddonRuntimeHandle(handle)).toBe(true);
        expect(startToolRuntime).toHaveBeenCalledTimes(1);
        await handle.stop({ drain: true, signal: new AbortController().signal });
        expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it('resume 은 없다 — 다시 켜려면 재시작(restart_required)', async () => {
        const handle = await startMcpRuntime();
        expect(handle.resume).toBeUndefined();
    });
});
