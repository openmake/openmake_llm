/**
 * external-keys-repo OAuth upsert 회귀 테스트.
 *
 * 라이브 E2E 에서 발견된 결함 (2026-07-26): OAuth 행의 key_prefix 를
 * 'oauth:' + 계정ID 12자로 만들면 18자가 되어 VARCHAR(16) 컬럼 INSERT 가
 * "value too long" 으로 실패했다. 유닛 테스트가 DB 를 타지 않아 놓쳤던 갭 —
 * 쿼리 파라미터를 캡처해 길이 상한을 직접 검증한다.
 */
import { ExternalKeysRepository } from '../external-keys-repo';

/** DB key_prefix 컬럼 상한 (마이그레이션 016) */
const KEY_PREFIX_COLUMN_MAX = 16;

type CapturedQuery = { sql: string; params: unknown[] };

function makeRepo(captured: CapturedQuery[]): ExternalKeysRepository {
    const repo = new ExternalKeysRepository({} as never);
    // BaseRepository.query 는 protected — 테스트에서 캡처 스텁으로 대체
    (repo as unknown as { query: unknown }).query = (sql: string, params: unknown[]) => {
        captured.push({ sql, params });
        return Promise.resolve({
            rows: [{
                id: 1,
                user_id: 'u1',
                provider_id: 'chatgpt',
                sdk_type: 'openai-compatible',
                auth_method: 'oauth',
                display_name: 'ChatGPT',
                base_url: null,
                encrypted_key: 'enc',
                key_prefix: String(params[6]),
                oauth_account_id: null,
                oauth_expires_at: null,
                is_active: true,
                last_validated_at: null,
                last_validation_ok: null,
                last_validation_error: null,
                last_used_at: null,
                created_at: new Date(0),
                updated_at: new Date(0),
            }],
        });
    };
    return repo;
}

describe('ExternalKeysRepository.upsert — OAuth key_prefix', () => {
    const longAccountId = 'acc_0123456789abcdefghijklmnop';

    it('긴 계정 ID 여도 key_prefix 가 컬럼 상한을 넘지 않는다', async () => {
        const captured: CapturedQuery[] = [];
        const repo = makeRepo(captured);

        await repo.upsert({
            userId: 'u1',
            providerId: 'chatgpt',
            sdkType: 'openai-compatible',
            displayName: 'ChatGPT',
            apiKey: JSON.stringify({ accessToken: 'a', refreshToken: 'r' }),
            authMethod: 'oauth',
            oauthAccountId: longAccountId,
        });

        const prefix = captured[0].params[6] as string;
        expect(prefix.length).toBeLessThanOrEqual(KEY_PREFIX_COLUMN_MAX);
        expect(prefix.startsWith('oauth:')).toBe(true);
    });

    it('계정 ID 미상이어도 상한을 지키고 세션 페이로드를 노출하지 않는다', async () => {
        const captured: CapturedQuery[] = [];
        const repo = makeRepo(captured);
        const sessionJson = JSON.stringify({ accessToken: 'super-secret-token', refreshToken: 'r' });

        await repo.upsert({
            userId: 'u1',
            providerId: 'chatgpt',
            sdkType: 'openai-compatible',
            displayName: 'ChatGPT',
            apiKey: sessionJson,
            authMethod: 'oauth',
        });

        const prefix = captured[0].params[6] as string;
        expect(prefix.length).toBeLessThanOrEqual(KEY_PREFIX_COLUMN_MAX);
        // 평문 세션 조각이 prefix 로 새지 않아야 한다
        expect(prefix).not.toContain('super-secret');
        expect(prefix).not.toContain('accessToken');
    });

    it('api_key 방식은 기존 prefix 동작(앞 12자 + ...)을 유지한다', async () => {
        const captured: CapturedQuery[] = [];
        const repo = makeRepo(captured);

        await repo.upsert({
            userId: 'u1',
            providerId: 'openrouter',
            sdkType: 'openai-compatible',
            displayName: 'OpenRouter',
            apiKey: 'sk-or-v1-abcdefghijklmnop',
        });

        const prefix = captured[0].params[6] as string;
        expect(prefix).toBe('sk-or-v1-abc...');
        expect(prefix.length).toBeLessThanOrEqual(KEY_PREFIX_COLUMN_MAX);
        expect(captured[0].params[7]).toBe('api_key');
    });
});
