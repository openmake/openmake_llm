/**
 * 마이그레이션 199 — 외부(BYOK) 키 켜고 끄기(enabled), ExternalKeysRepository 실제 Postgres 의미 검증.
 * TEST_DATABASE_URL 이 없으면 skip 한다(로컬 본 DB·운영에 붙지 않는다 — 전용 테스트 DB 에서만).
 *
 * 테스트 DB 의 실제 표에 고유 접두사 사용자 fixture 를 만들고 끝나면 지운다(키 행은 users CASCADE).
 * 199 는 멱등이라 beforeAll 에서 한 번 더 적용한다. 키 값은 더미다.
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ExternalKeysRepository } from '../../data/repositories/external-keys-repo';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const MIGRATIONS = path.resolve(__dirname, '../../../../../db/migrations');
const FORWARD = fs.readFileSync(path.join(MIGRATIONS, '199_external_key_enabled.sql'), 'utf8');

const P = `eke-${randomUUID().slice(0, 8)}`;
const DUMMY_KEY = 'sk-test-dummy-0000000000';

describeOrSkip('마이그레이션 199 — 외부 키 enabled (테스트 DB 실제 표)', () => {
    let pool: Pool;
    let repo: ExternalKeysRepository;
    const users: string[] = [];

    async function user(name: string): Promise<string> {
        const id = `${P}-u-${name}-${randomUUID().slice(0, 6)}`;
        await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [id]);
        users.push(id);
        return id;
    }
    async function key(userId: string, providerId = 'gemini') {
        return repo.upsert({ userId, providerId, sdkType: 'openai-compatible', displayName: 'Gemini', baseUrl: 'https://example.invalid/v1', apiKey: DUMMY_KEY });
    }

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 2 });
        await pool.query(FORWARD);
        repo = new ExternalKeysRepository(pool);
    });
    afterAll(async () => {
        if (users.length) await pool.query('DELETE FROM users WHERE id = ANY($1)', [users]);
        await pool.end();
    });

    it('새 키는 기본으로 켜져 있다', async () => {
        const u = await user('new');
        const row = await key(u);
        expect(row.enabled).toBe(true);
        expect((await repo.getByUserAndProvider(u, 'gemini'))?.enabled).toBe(true);
        expect(await repo.decryptKey(u, 'gemini')).toBe(DUMMY_KEY);
    });

    it('끄면 기본 조회·복호화에서 빠지고 includeDisabled 로만 보이며, 다시 켜면 복구된다', async () => {
        const u = await user('toggle');
        await key(u);
        const off = await repo.setEnabled(u, 'gemini', false);
        expect(off).toMatchObject({ providerId: 'gemini', enabled: false, isActive: true, baseUrl: 'https://example.invalid/v1' });

        expect(await repo.getByUserAndProvider(u, 'gemini')).toBeNull();
        expect(await repo.listByUser(u)).toEqual([]);
        expect(await repo.decryptKey(u, 'gemini')).toBeNull();
        expect((await repo.getByUserAndProvider(u, 'gemini', { includeDisabled: true }))?.enabled).toBe(false);
        const all = await repo.listByUser(u, { includeDisabled: true });
        expect(all.map((r) => [r.providerId, r.enabled])).toEqual([['gemini', false]]);

        // 같은 값으로 다시 불러도 같은 결과(멱등)
        expect((await repo.setEnabled(u, 'gemini', false))?.enabled).toBe(false);

        const on = await repo.setEnabled(u, 'gemini', true);
        expect(on?.enabled).toBe(true);
        expect((await repo.getByUserAndProvider(u, 'gemini'))?.enabled).toBe(true);
        expect(await repo.decryptKey(u, 'gemini')).toBe(DUMMY_KEY);
    });

    it('켜진 키와 꺼진 키가 섞이면 기본 listByUser 는 켜진 것만, includeDisabled 는 둘 다 돌려준다', async () => {
        const u = await user('mixed');
        await key(u, 'gemini');
        await key(u, 'openai');
        await repo.setEnabled(u, 'openai', false);

        expect((await repo.listByUser(u)).map((r) => [r.providerId, r.enabled])).toEqual([['gemini', true]]);
        const all = await repo.listByUser(u, { includeDisabled: true });
        expect(all.map((r) => [r.providerId, r.enabled])).toEqual([['gemini', true], ['openai', false]]);
    });

    it('꺼진 행에도 updateOAuthSession 이 반영되어 다시 켜면 갱신된 값이 복호화된다', async () => {
        // 설계 §4.1 — updateOAuthSession 에 enabled 조건을 넣지 않는다(꺼 둔 OAuth 연결이 다시 켰을 때 깨지지 않게)
        const u = await user('oauth-off');
        const OLD = '{"access_token":"dummy-old"}';
        const NEW = '{"access_token":"dummy-new"}';
        await repo.upsert({ userId: u, providerId: 'gemini', sdkType: 'openai-compatible', displayName: 'Gemini', baseUrl: 'https://example.invalid/v1', apiKey: OLD, authMethod: 'oauth', oauthAccountId: 'acct-dummy', oauthExpiresAt: null });
        await repo.setEnabled(u, 'gemini', false);

        await repo.updateOAuthSession(u, 'gemini', { plaintextSession: NEW, oauthExpiresAt: null });
        expect(await repo.decryptKey(u, 'gemini')).toBeNull();

        await repo.setEnabled(u, 'gemini', true);
        expect(await repo.decryptKey(u, 'gemini')).toBe(NEW);
    });

    it('꺼진 키에 upsert(키 교체·재등록)하면 켜진다', async () => {
        const u = await user('upsert');
        await key(u);
        await repo.setEnabled(u, 'gemini', false);
        const re = await key(u);
        expect(re.enabled).toBe(true);
        expect(await repo.decryptKey(u, 'gemini')).toBe(DUMMY_KEY);
    });

    it('삭제된 행·없는 행에 setEnabled 는 null 이다', async () => {
        const u = await user('deleted');
        await key(u);
        expect(await repo.deactivate(u, 'gemini')).toBe(true);
        expect(await repo.setEnabled(u, 'gemini', true)).toBeNull();
        expect(await repo.setEnabled(u, 'openai', true)).toBeNull();
        expect(await repo.getByUserAndProvider(u, 'gemini', { includeDisabled: true })).toBeNull();
    });

    it('꺼진 키도 삭제(deactivate)된다', async () => {
        const u = await user('delete-off');
        await key(u);
        await repo.setEnabled(u, 'gemini', false);
        expect(await repo.deactivate(u, 'gemini')).toBe(true);
        expect(await repo.getByUserAndProvider(u, 'gemini', { includeDisabled: true })).toBeNull();
        expect(await repo.listByUser(u, { includeDisabled: true })).toEqual([]);
    });
});
