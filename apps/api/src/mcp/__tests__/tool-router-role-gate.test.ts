/**
 * ToolRouter × 역할 게이트 2차 방어 (2026-09-02 보안 리뷰 B7-01)
 * 노출 필터에서 빠진 고위험 서버 도구를 이름으로 직접 호출해도 역할 미달이면 실행되지 않는다.
 */
import { ToolRouter } from '../tool-router';
import { filterRestrictedTools } from '../../services/chat-service/tool-restrictions';

const ORIGINAL = process.env.MCP_RESTRICTED_SERVERS;

function makeRouter(exec: jest.Mock): ToolRouter {
    const router = new ToolRouter();
    router.registerExternalTools(
        'srv-py', 'Python REPL',
        [{ name: 'run_code', description: 'exec', inputSchema: { type: 'object', properties: {} } }],
        exec,
    );
    return router;
}

describe('ToolRouter 역할 게이트', () => {
    beforeEach(() => { process.env.MCP_RESTRICTED_SERVERS = 'Python REPL:admin'; });
    afterEach(() => { if (ORIGINAL === undefined) delete process.env.MCP_RESTRICTED_SERVERS; else process.env.MCP_RESTRICTED_SERVERS = ORIGINAL; });

    it('user 역할이 이름으로 직접 호출하면 실행 없이 거절', async () => {
        const exec = jest.fn(async () => ({ content: [{ type: 'text' as const, text: 'ran' }] }));
        const r = await makeRouter(exec).executeTool('Python REPL::run_code', {}, { userId: 'u1', role: 'user' });
        expect(r.isError).toBe(true);
        expect(exec).not.toHaveBeenCalled();
    });

    it('guest 도 거절', async () => {
        const exec = jest.fn(async () => ({ content: [{ type: 'text' as const, text: 'ran' }] }));
        const r = await makeRouter(exec).executeTool('Python REPL::run_code', {}, { userId: 'g', role: 'guest' });
        expect(r.isError).toBe(true);
        expect(exec).not.toHaveBeenCalled();
    });

    it('admin 은 실행', async () => {
        const exec = jest.fn(async () => ({ content: [{ type: 'text' as const, text: 'ran' }] }));
        const r = await makeRouter(exec).executeTool('Python REPL::run_code', {}, { userId: 'a', role: 'admin' });
        expect(r.isError).toBeFalsy();
        expect(exec).toHaveBeenCalledTimes(1);
    });

    it('제한 목록이 비면 user 도 실행', async () => {
        process.env.MCP_RESTRICTED_SERVERS = '';
        const exec = jest.fn(async () => ({ content: [{ type: 'text' as const, text: 'ran' }] }));
        const r = await makeRouter(exec).executeTool('Python REPL::run_code', {}, { userId: 'u1', role: 'user' });
        expect(r.isError).toBeFalsy();
        expect(exec).toHaveBeenCalledTimes(1);
    });

    it('노출 필터와 같은 정책을 본다', () => {
        const tools = [{ type: 'function' as const, function: { name: 'Python REPL::run_code', description: '', parameters: { type: 'object' as const, properties: {} } } }];
        expect(filterRestrictedTools(tools, 'user')).toHaveLength(0);
        expect(filterRestrictedTools(tools, 'admin')).toHaveLength(1);
    });
});
