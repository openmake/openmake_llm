import type { Pool } from 'pg';
import { McpCatalogRepository } from '../mcp-catalog-repository';
import { decryptToken, encryptToken } from '../../../utils/token-crypto';

describe('McpCatalogRepository.listCatalog', () => {
    it('활성화된 전체 템플릿을 제한 없이 반환 (tier 필터 없음)', async () => {
        const rows = [
            { id: 'mcp-firecrawl', display_name: 'Firecrawl', is_enabled: true },
            { id: 'mcp-duckduckgo', display_name: 'DuckDuckGo', is_enabled: true },
        ];
        const queryMock = jest.fn().mockResolvedValue({ rows });
        const fakePool = { query: queryMock } as unknown as Pool;
        const repo = new McpCatalogRepository(fakePool);

        const templates = await repo.listCatalog();

        expect(templates).toHaveLength(2);
        // tier 파라미터 없이 호출 — 쿼리에 tier 바인딩 인자가 없어야 함
        const callArgs = queryMock.mock.calls[0];
        expect(callArgs.length).toBe(1);
        expect(callArgs[0]).not.toContain('required_tier');
    });
});

describe('McpCatalogRepository.updateEnv', () => {
    const template = {
        id: 'mcp-github',
        env_schema: { properties: { GITHUB_PERSONAL_ACCESS_TOKEN: { secret: true }, GH_HOST: { secret: false } } },
    } as never;

    /** SELECT(기존 env) → UPDATE(RETURNING) 2회 호출을 순서대로 흉내낸다. */
    const makePool = (existing: Record<string, string> | null, rowCount = 1) => {
        const queryMock = jest.fn()
            .mockResolvedValueOnce({ rowCount, rows: [{ env: existing }] })
            .mockImplementationOnce((_sql: string, params: unknown[]) =>
                Promise.resolve({ rows: [{ id: 's1', env: JSON.parse(String(params[1])) }] }));
        return { queryMock, pool: { query: queryMock } as unknown as Pool };
    };

    it('secret 필드는 암호화하고 비-secret 은 평문으로 저장한다', async () => {
        const { queryMock, pool } = makePool({ GITHUB_PERSONAL_ACCESS_TOKEN: 'v1:old', GH_HOST: 'github.com' });
        const repo = new McpCatalogRepository(pool);

        await repo.updateEnv('s1', { GITHUB_PERSONAL_ACCESS_TOKEN: 'new-token', GH_HOST: 'ghe.internal' }, template);

        const saved = JSON.parse(String(queryMock.mock.calls[1]![1]![1]));
        expect(saved.GITHUB_PERSONAL_ACCESS_TOKEN).toMatch(/^v1:/);
        expect(decryptToken(saved.GITHUB_PERSONAL_ACCESS_TOKEN)).toBe('new-token');
        expect(saved.GH_HOST).toBe('ghe.internal'); // 평문 유지
    });

    it('patch 에 없는 기존 키는 보존한다 (부분 갱신)', async () => {
        const { queryMock, pool } = makePool({ A: 'keep', GH_HOST: 'github.com' });
        const repo = new McpCatalogRepository(pool);

        await repo.updateEnv('s1', { GH_HOST: 'changed' }, template);

        const saved = JSON.parse(String(queryMock.mock.calls[1]![1]![1]));
        expect(saved.A).toBe('keep');
        expect(saved.GH_HOST).toBe('changed');
    });

    it('템플릿이 없어도 기존 값이 암호문이면 secret 으로 간주해 재암호화한다', async () => {
        const { queryMock, pool } = makePool({ SOME_TOKEN: 'v1:oldcipher' });
        const repo = new McpCatalogRepository(pool);

        await repo.updateEnv('s1', { SOME_TOKEN: 'rotated' }, null);

        const saved = JSON.parse(String(queryMock.mock.calls[1]![1]![1]));
        expect(saved.SOME_TOKEN).toMatch(/^v1:/);
        expect(decryptToken(saved.SOME_TOKEN)).toBe('rotated');
    });

    it('허용되지 않은 키는 거부한다 (spawn 환경 오염 차단)', async () => {
        const { pool } = makePool({ GH_HOST: 'github.com' });
        const repo = new McpCatalogRepository(pool);

        await expect(repo.updateEnv('s1', { PATH: '/evil' }, template)).rejects.toThrow(/허용되지 않은/);
    });

    it('존재하지 않는 서버는 null 을 반환한다', async () => {
        const { pool } = makePool(null, 0);
        const repo = new McpCatalogRepository(pool);

        await expect(repo.updateEnv('nope', { GH_HOST: 'x' }, template)).resolves.toBeNull();
    });
});

describe('McpCatalogRepository.decryptEnvForSpawn', () => {
    const repoWith = (env: Record<string, string> | null) => {
        const queryMock = jest.fn().mockResolvedValue({ rows: [{ env }] });
        return new McpCatalogRepository({ query: queryMock } as unknown as Pool);
    };

    it('암호문은 복호화하고 평문은 그대로 둔다', async () => {
        const repo = repoWith({ SECRET: encryptToken('plain-value'), TIMEOUT: '30' });

        await expect(repo.decryptEnvForSpawn('s1')).resolves.toEqual({
            SECRET: 'plain-value',
            TIMEOUT: '30',
        });
    });

    it('복호화 실패 시 암호문을 그대로 넘기지 않고 throw 한다 (fail-closed)', async () => {
        // decryptToken 은 fail-open — 포맷 오류 시 예외 없이 입력을 그대로 돌려준다.
        // 그걸 그대로 spawn env 에 넣으면 "서버는 뜨는데 API 호출만 401" 로 조용히 깨진다.
        const repo = repoWith({ SECRET: 'v1:broken-ciphertext' });

        await expect(repo.decryptEnvForSpawn('s1')).rejects.toThrow(/복호화 실패/);
    });

    it('env 가 없으면 빈 객체', async () => {
        await expect(repoWith(null).decryptEnvForSpawn('s1')).resolves.toEqual({});
    });
});
