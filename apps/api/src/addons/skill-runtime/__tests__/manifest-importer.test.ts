import type { Pool } from 'pg';
import { ManifestImporter } from '../manifest-importer';
import { SkillManifestFrontmatterSchema } from '../../../schemas/skill-manifest.schema';

/** 쿼리를 기록만 하는 가짜 pool — SELECT 는 기존 행 rows 를 돌려준다. */
function fakePool(existing: Array<{ checksum: string }> = []) {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
        query: jest.fn(async (sql: string, params?: unknown[]) => {
            calls.push({ sql, params });
            if (sql.startsWith('SELECT checksum')) return { rowCount: existing.length, rows: existing };
            return { rowCount: 1, rows: [] };
        }),
        release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client) } as unknown as Pool;
    return { pool, client, calls };
}

const manifest = SkillManifestFrontmatterSchema.parse({
    name: 'Repo Helper',
    description: 'test skill',
    version: '1.2.0',
    tool_bindings: [{ tool_name: 'web_search', mode: 'required' }],
    mcp_bundles: [{ server_name: 'github', server_config: { transport_type: 'stdio', command: 'npx' } }],
});

const input = { manifest, prompt_md: '# body', raw_yaml: 'name: Repo Helper', checksum: 'abc', createdBy: '42', isAdmin: false };

describe('ManifestImporter', () => {
    it('manifest·바인딩·mcp_bundles 를 한 트랜잭션으로 기록하고 업로더에게 배정한다', async () => {
        const { pool, client, calls } = fakePool();
        const result = await new ManifestImporter(pool).import(input);

        expect(result).toEqual({ skill_id: 'user-42-repo-helper', version: '1.2.0', inserted: true, duplicate_checksum: false });
        const sqls = calls.map((c) => c.sql.trim().split(/\s+/).slice(0, 3).join(' '));
        expect(sqls[0]).toBe('BEGIN');
        expect(sqls.at(-1)).toBe('COMMIT');

        const binding = calls.find((c) => c.sql.includes('INSERT INTO skill_tool_bindings'));
        expect(binding?.params).toEqual(['user-42-repo-helper', '1.2.0', 'web_search', 'required', null]);

        // mcp_bundles 는 기록만 — 선언 원문과 기본 lifecycle 이 그대로 남는다(실행 경로는 없다).
        const bundle = calls.find((c) => c.sql.includes('INSERT INTO skill_mcp_bundles'));
        expect(bundle?.params?.slice(0, 3)).toEqual(['user-42-repo-helper', '1.2.0', 'github']);
        expect(JSON.parse(bundle?.params?.[3] as string)).toEqual({ transport_type: 'stdio', command: 'npx' });
        expect(bundle?.params?.[4]).toBe('per_chat');

        const assign = calls.find((c) => c.sql.includes('INSERT INTO agent_skill_assignments'));
        expect(assign?.params).toEqual(['user:42', 'user-42-repo-helper']);
        expect(client.release).toHaveBeenCalled();
    });

    it('같은 (id, version)·같은 checksum 이면 아무것도 쓰지 않는다(멱등)', async () => {
        const { pool, calls } = fakePool([{ checksum: 'abc' }]);
        const result = await new ManifestImporter(pool).import(input);

        expect(result).toMatchObject({ inserted: false, duplicate_checksum: true });
        expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
    });

    it('같은 (id, version) 인데 checksum 이 다르면 거절한다', async () => {
        const { pool } = fakePool([{ checksum: 'other' }]);
        await expect(new ManifestImporter(pool).import(input)).rejects.toThrow('checksum 다름');
    });
});
