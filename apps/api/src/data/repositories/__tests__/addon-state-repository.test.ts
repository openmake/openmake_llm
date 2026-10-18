/**
 * AddonStateRepository.setState — failure_reason 은 failed 로 바꿀 때만 저장한다.
 * 끄기·켜기의 사유는 감사 로그(addon.state_changed)에 남으므로 실패 사유 칸에 넣지 않는다 —
 * 넣으면 정상 add-on 이 관리자 화면에 실패 문구로 보인다.
 */
import { Pool } from 'pg';
import { AddonStateRepository } from '../addon-state-repository';

function makeMockPool() {
    return { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
}

describe('AddonStateRepository.setState', () => {
    let pool: Pool;
    let repo: AddonStateRepository;

    beforeEach(() => {
        pool = makeMockPool();
        repo = new AddonStateRepository(pool);
    });

    it.each(['disabled', 'enabled', 'installed'] as const)('%s 전환의 사유는 failure_reason 에 저장하지 않는다(NULL)', async (state) => {
        await repo.setState('kn', state, 'x');
        const [, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(params[2]).toBeNull();
    });

    it('failed 전환의 사유는 failure_reason 으로 저장한다', async () => {
        await repo.setState('kn', 'failed', 'x');
        const [, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(params[2]).toBe('x');
    });
});
