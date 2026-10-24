/**
 * git ingest draft 승인의 저장 시점 제어 env 거부(#1471 후속) — 실제로 저장될 env(draft.env + 승인 화면 override)에
 * 제어 키가 있으면 UPDATE(활성화) 전에 거부한다. 오류에는 키 이름만 있고 값은 없다. GIT_TOKEN 은 허용.
 */
import type { Pool } from 'pg';
import { McpServerDraftRepository } from '../../data/mcp-server-draft-repository';
import { McpCatalogInputError } from '../../../../security/spawn-env-policy';

const SECRET = `v-${Math.random().toString(36).slice(2)}`;
const draftRow = (env: Record<string, string> | null) => ({
    id: 'd-1', name: 'git-srv', user_id: 'u-1', status: 'draft', env, manifest_meta: {},
});
function repoWith(env: Record<string, string> | null) {
    const query = jest.fn(async (sql: string) => (/^\s*SELECT/i.test(sql)
        ? { rows: [draftRow(env)], rowCount: 1 }
        : { rows: [{ ...draftRow(env), status: 'active' }], rowCount: 1 }));
    return { query, repo: new McpServerDraftRepository({ query } as unknown as Pool) };
}
const updates = (query: jest.Mock) => query.mock.calls.filter(([sql]) => /UPDATE/i.test(String(sql)));

describe('McpServerDraftRepository.approve — 저장 전 제어 env 거부', () => {
    it('승인 override 에 제어 키(GIT_DIR)가 있으면 활성화 UPDATE 를 하지 않는다', async () => {
        const { query, repo } = repoWith({ API_KEY: 'k' });
        const err = await repo.approve({ id: 'd-1', userId: 'u-1', isAdmin: false, envOverrides: { GIT_DIR: SECRET } }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(McpCatalogInputError);
        expect((err as Error).message).toContain('GIT_DIR');
        expect((err as Error).message).not.toContain(SECRET);
        expect(updates(query)).toHaveLength(0);
    });

    it('draft.env(매니페스트) 에 제어 키(LD_PRELOAD)가 남아 있으면 override 없이도 활성화하지 않는다', async () => {
        const { query, repo } = repoWith({ LD_PRELOAD: SECRET, API_KEY: 'k' });
        const err = await repo.approve({ id: 'd-1', userId: 'u-1', isAdmin: false }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(McpCatalogInputError);
        expect((err as Error).message).toContain('LD_PRELOAD');
        expect(updates(query)).toHaveLength(0);
    });

    it('GIT_TOKEN 같은 자격증명 이름은 그대로 저장·활성화한다', async () => {
        const { query, repo } = repoWith({ API_KEY: 'k' });
        const row = await repo.approve({ id: 'd-1', userId: 'u-1', isAdmin: false, envOverrides: { GIT_TOKEN: SECRET } });
        expect(row).toMatchObject({ status: 'active' });
        expect(updates(query)).toHaveLength(1);
        expect(JSON.parse(String((updates(query)[0][1] as unknown[])[1]))).toEqual({ API_KEY: 'k', GIT_TOKEN: SECRET });
    });
});
