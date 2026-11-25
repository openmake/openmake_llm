/**
 * 확장 agents/*.md → Custom Agent 설치 상태 (opt-in EXTENSION_AGENT_APPROVAL_REQUIRED, 206, 2026-11-25).
 * 기본(옵션 OFF)은 종전대로 즉시 활성(approved), 옵션 ON 이면 승인 대기(pending).
 */
import type { Pool } from 'pg';
import { collectPluginAgents, type ComponentContext } from '../extension-components';

const AGENT_MD = '---\nname: reviewer\ndescription: 코드 리뷰어\n---\n너는 꼼꼼한 코드 리뷰어다. 변경을 검토한다.';
const ORIGINAL = process.env.EXTENSION_AGENT_APPROVAL_REQUIRED;

function ctxWith(inserts: unknown[][]): ComponentContext {
    const pool = {
        query: async (sql: string, params: unknown[] = []) => {
            if (/^\s*INSERT INTO user_agents/i.test(sql)) { inserts.push(params); return { rows: [{ id: params[0], name: params[2] }], rowCount: 1 }; }
            return { rows: [], rowCount: 0 };
        },
    } as unknown as Pool;
    return {
        pool,
        fetcher: { fetchFile: async () => AGENT_MD } as unknown as ComponentContext['fetcher'],
        owner: 'o', repo: 'r', sha: 's',
        tree: { entries: [{ path: 'agents/reviewer.md', sha: 'b', size: 1, type: 'blob' }] } as unknown as ComponentContext['tree'],
        root: '', userId: 'u1', isAdmin: false, gitUrl: 'o/r', manifestPath: 'plugin.json',
        extensionName: 'pack', warnings: [],
    } as ComponentContext;
}

afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EXTENSION_AGENT_APPROVAL_REQUIRED;
    else process.env.EXTENSION_AGENT_APPROVAL_REQUIRED = ORIGINAL;
});

describe('collectPluginAgents 승인 상태', () => {
    it('옵션이 꺼져 있으면(기본) 종전대로 즉시 활성(approved)', async () => {
        delete process.env.EXTENSION_AGENT_APPROVAL_REQUIRED;
        const inserts: unknown[][] = [];
        const ctx = ctxWith(inserts);
        const r = await collectPluginAgents(ctx);
        expect(r[0].agentId).toBeDefined();
        expect(inserts[0].at(-1)).toBe('approved');
        expect(ctx.warnings.join('\n')).toContain('즉시 사용 가능');
    });

    it('EXTENSION_AGENT_APPROVAL_REQUIRED=true 면 승인 대기(pending)로 설치', async () => {
        process.env.EXTENSION_AGENT_APPROVAL_REQUIRED = 'true';
        const inserts: unknown[][] = [];
        const ctx = ctxWith(inserts);
        await collectPluginAgents(ctx);
        expect(inserts[0].at(-1)).toBe('pending');
        expect(ctx.warnings.join('\n')).toContain('승인 후 사용 가능');
    });
});
