/**
 * 복호화 fail-closed 회귀 테스트.
 *
 * `decryptToken` 은 fail-open 이라 키 부재·포맷 오류 시 예외 없이 **암호문을 그대로**
 * 돌려준다. 그 값을 반환하면 암호문이 API 키나 Bearer 토큰으로 쓰여, 요청은 나가지만
 * 401 만 돌아오는 조용한 실패가 된다. 각 repo 가 이를 감지해 null/undefined 로 내리는지
 * 검증한다.
 */
import { ExternalKeysRepository } from '../external-keys-repo';
import { ExternalRepository } from '../external-repository';
import { ServerExternalKeysRepository } from '../server-external-keys-repo';
import { encryptToken } from '../../../utils/token-crypto';

/** BaseRepository.query 는 protected — 고정 결과를 돌려주는 스텁으로 대체 */
const stubQuery = <T>(repo: T, rows: unknown[]): T => {
    (repo as unknown as { query: unknown }).query = () => Promise.resolve({ rows, rowCount: rows.length });
    return repo;
};

/** 손상된 암호문 — decryptToken 이 포맷 오류로 원본을 그대로 반환한다 */
const BROKEN = 'v1:not-a-valid-ciphertext';

describe('ExternalKeysRepository.decryptKey — fail-closed', () => {
    it('정상 암호문은 평문으로 복호화한다', async () => {
        const repo = stubQuery(new ExternalKeysRepository({} as never), [{ encrypted_key: encryptToken('sk-live-123') }]);

        await expect(repo.decryptKey('u1', 'openai')).resolves.toBe('sk-live-123');
    });

    it('복호화 실패 시 암호문을 반환하지 않고 null 을 돌려준다', async () => {
        const repo = stubQuery(new ExternalKeysRepository({} as never), [{ encrypted_key: BROKEN }]);

        // null 이어야 호출자(provider-router 등)의 "키 없음" 폴백이 작동한다.
        await expect(repo.decryptKey('u1', 'openai')).resolves.toBeNull();
    });

    it('행이 없으면 null', async () => {
        const repo = stubQuery(new ExternalKeysRepository({} as never), []);

        await expect(repo.decryptKey('u1', 'openai')).resolves.toBeNull();
    });
});

describe('ServerExternalKeysRepository.decryptKey — fail-closed', () => {
    it('복호화 실패 시 null (try/catch 는 fail-open 이라 발동하지 않으므로 명시 판별 필요)', async () => {
        const repo = stubQuery(new ServerExternalKeysRepository({} as never), [{ encrypted_key: BROKEN }]);

        await expect(repo.decryptKey('openai')).resolves.toBeNull();
    });

    it('정상 암호문은 평문 반환', async () => {
        const repo = stubQuery(new ServerExternalKeysRepository({} as never), [{ encrypted_key: encryptToken('server-key') }]);

        await expect(repo.decryptKey('openai')).resolves.toBe('server-key');
    });
});

describe('ExternalRepository OAuth 토큰 — fail-closed', () => {
    const row = (over: Record<string, unknown>) => ({
        id: 'c1', user_id: 'u1', service_type: 'github',
        access_token: null, refresh_token: null,
        is_active: true, metadata: {}, created_at: '', updated_at: '',
        ...over,
    });

    it('정상 토큰은 평문으로 복호화한다', async () => {
        const repo = stubQuery(new ExternalRepository({} as never), [row({ access_token: encryptToken('gho_real') })]);

        const conn = await repo.getUserConnectionByService('u1', 'github' as never);
        expect(conn?.access_token).toBe('gho_real');
    });

    it('복호화 실패한 토큰은 암호문 대신 undefined — 암호문이 Bearer 로 새지 않는다', async () => {
        const repo = stubQuery(new ExternalRepository({} as never), [row({ access_token: BROKEN })]);

        const conn = await repo.getUserConnectionByService('u1', 'github' as never);
        expect(conn?.access_token).toBeUndefined();
        // 커넥션 자체는 살아 있어야 호출자가 "토큰 없음"으로 degrade 할 수 있다
        expect(conn?.id).toBe('c1');
    });

    it('목록 조회에서 한 건이 손상돼도 나머지는 정상 반환한다', async () => {
        const repo = stubQuery(new ExternalRepository({} as never), [
            row({ id: 'broken', access_token: BROKEN }),
            row({ id: 'healthy', access_token: encryptToken('gho_ok') }),
        ]);

        const list = await repo.getUserConnections('u1');

        expect(list).toHaveLength(2); // 전체 실패 금지
        expect(list.find((c) => c.id === 'broken')?.access_token).toBeUndefined();
        expect(list.find((c) => c.id === 'healthy')?.access_token).toBe('gho_ok');
    });
});
