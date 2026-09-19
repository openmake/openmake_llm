/**
 * 메타 도구 `mcp_call` 정규화 — 종전 od-artifact-echo.test 에 있던 판정을 런타임 소유로 옮겼다 (2026-09-19).
 * Base 의 기본 런타임은 이 변환을 모른다(그대로 통과) — 변환은 MCP 런타임 add-on 의 계약이다.
 */
import { mcpToolRuntime } from '../runtime';

describe('mcpToolRuntime.normalizeToolCall', () => {
    it('mcp_call 간접 호출을 server::tool 로 정규화한다', () => {
        const eff = mcpToolRuntime.normalizeToolCall('mcp_call', {
            server: 'open-design',
            tool: 'create_artifact',
            args: { name: 'deck.html', content: '<html></html>' },
        });
        expect(eff.name).toBe('open-design::create_artifact');
        expect(eff.args.content).toBe('<html></html>');
    });

    it('일반 도구 호출은 그대로 통과한다', () => {
        const args = { q: 'x' };
        const eff = mcpToolRuntime.normalizeToolCall('web_search', args);
        expect(eff.name).toBe('web_search');
        expect(eff.args).toBe(args);
    });
});
