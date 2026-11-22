import { mcpBundlesNotice } from '../mcp-bundles-notice';

describe('mcpBundlesNotice (mcp_bundles 는 기록만, 실행 안 함)', () => {
    it('선언이 없으면 안내하지 않는다', () => {
        expect(mcpBundlesNotice([])).toBeNull();
    });

    it('선언이 있으면 개수·서버 이름과 함께 실행되지 않는다고 알린다', () => {
        const note = mcpBundlesNotice([{ server_name: 'github' }, { server_name: 'slack' }]);
        expect(note).toContain('mcp_bundles 2개(github, slack)');
        expect(note).toContain('실행되지 않습니다');
        expect(note).toContain('MCP 카탈로그');
    });
});
