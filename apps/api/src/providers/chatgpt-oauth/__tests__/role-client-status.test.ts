/**
 * ProviderRoleClient — ProviderError 에 부착하는 status 가 공유 맵 PROVIDER_ERROR_HTTP_STATUS 와 같은지.
 *
 * 2026-09-16: chatgpt 전용 상태표(9 코드)를 제거하고 REST 와 같은 맵을 쓰도록 통합.
 * 역할 경로 폴백 규약(4xx → 로컬 1회 강등)이 이 status 를 본다.
 */
import { createProviderRoleClient } from '../role-client';
import { ProviderError, PROVIDER_ERROR_HTTP_STATUS, type ProviderErrorCode } from '../../provider-errors';
import type { IProvider } from '../../i-provider';

const mkProvider = (err: unknown): IProvider =>
    ({ streamChat: jest.fn().mockRejectedValue(err) } as unknown as IProvider);

describe('ProviderRoleClient — ProviderError status 부착', () => {
    const codes = Object.keys(PROVIDER_ERROR_HTTP_STATUS) as ProviderErrorCode[];

    it.each(codes)('%s → 공유 맵의 상태를 status 로 부착한다', async (code) => {
        const client = createProviderRoleClient({ provider: mkProvider(new ProviderError(code, 'x')), modelId: 'm' });
        const caught = await client.chat([{ role: 'user', content: 'hi' }]).catch((e: unknown) => e);
        expect(caught).toBeInstanceOf(ProviderError);
        expect((caught as { status?: number }).status).toBe(PROVIDER_ERROR_HTTP_STATUS[code]);
    });

    it('ProviderError 가 아니면 status 를 붙이지 않고 그대로 재throw 한다', async () => {
        const client = createProviderRoleClient({ provider: mkProvider(new Error('plain')), modelId: 'm' });
        const caught = await client.chat([{ role: 'user', content: 'hi' }]).catch((e: unknown) => e);
        expect(caught).toBeInstanceOf(Error);
        expect((caught as { status?: number }).status).toBeUndefined();
    });
});
