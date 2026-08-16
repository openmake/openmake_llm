import type { Pool } from 'pg';
import {
    NativePushService,
    type APNsDeliveryResult,
    type NativePushPayload,
    type NativePushToken,
} from '../NativePushService';

function makeService() {
    const query = jest.fn();
    const deliver = jest.fn<Promise<APNsDeliveryResult>, [NativePushToken, NativePushPayload]>();
    const pool = { query } as unknown as Pool;
    return { query, deliver, service: new NativePushService(pool, deliver) };
}

describe('NativePushService', () => {
    it('upserts an iOS token for the authenticated user', async () => {
        const { query, service } = makeService();
        query.mockResolvedValueOnce({ rows: [] });

        await service.subscribe('u1', {
            deviceToken: 'a'.repeat(64),
            environment: 'development',
            bundleId: 'cc.openmake.chat',
        });

        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO mobile_push_tokens'),
            ['u1', 'a'.repeat(64), 'development', 'cc.openmake.chat'],
        );
    });

    it('removes an APNs token after an unregistered response', async () => {
        const { query, deliver, service } = makeService();
        const token: NativePushToken = {
            deviceToken: 'b'.repeat(64),
            environment: 'production',
            bundleId: 'cc.openmake.chat',
        };
        query
            .mockResolvedValueOnce({ rows: [{
                device_token: token.deviceToken,
                environment: token.environment,
                bundle_id: token.bundleId,
            }] })
            .mockResolvedValueOnce({ rows: [] });
        deliver.mockResolvedValueOnce({ status: 410, reason: 'Unregistered' });

        await service.sendPush('u1', { title: '완료', body: '작업이 끝났습니다', url: '/agent-tasks' });

        expect(deliver).toHaveBeenCalledWith(token, {
            title: '완료', body: '작업이 끝났습니다', url: '/agent-tasks',
        });
        expect(query).toHaveBeenLastCalledWith(
            expect.stringContaining('DELETE FROM mobile_push_tokens'),
            [token.deviceToken],
        );
    });
});
