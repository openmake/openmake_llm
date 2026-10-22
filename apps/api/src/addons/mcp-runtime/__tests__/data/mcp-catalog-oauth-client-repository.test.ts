/**
 * McpCatalogOAuthClientRepository — client_secret 복호화 실패 시 secret 없이 돌려준다.
 * 비-dev(NODE_ENV=staging) 에서 decryptToken 이 throw 해도 이 동작이 유지되는지 확인한다(S9 후속).
 */
import { McpCatalogOAuthClientRepository } from '../../data/mcp-catalog-oauth-client-repository';
import { encryptToken } from '../../../../utils/token-crypto';

const BROKEN = 'v1:not-a-valid-ciphertext';
const repoWith = (secretEnc: string) => new McpCatalogOAuthClientRepository({
    query: () => Promise.resolve({ rows: [{ catalog_id: 'c1', client_id: 'cid', client_secret_enc: secretEnc, token_endpoint_auth_method: null, scope: null }], rowCount: 1 }),
} as never);

describe('McpCatalogOAuthClientRepository client_secret 복호화', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.TOKEN_ENCRYPTION_KEY;
    beforeEach(() => {
        process.env.NODE_ENV = 'staging';
        if (!prevKey) process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    });
    afterEach(() => {
        process.env.NODE_ENV = prevEnv;
        if (prevKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
        else process.env.TOKEN_ENCRYPTION_KEY = prevKey;
    });

    it('정상 암호문은 secret 을 복호화해 돌려준다', async () => {
        const client = await repoWith(encryptToken('cs-123')).get('c1');
        expect(client?.clientSecret).toBe('cs-123');
    });

    it('staging 에서 손상된 암호문은 throw 없이 secret 없이 돌려준다', async () => {
        const client = await repoWith(BROKEN).get('c1');
        expect(client?.clientId).toBe('cid');
        expect(client?.clientSecret).toBeUndefined();
    });
});
