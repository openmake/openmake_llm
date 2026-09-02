/**
 * MarketplaceBundleRepository.loadForUser — 요청자 스코프 (2026-09-02 보안 리뷰 B9-01)
 * 무스코프 load 와 달리 소유자 또는 shared 게시 조건이 SQL 에 실리고 userId 가 바인딩되는지 고정한다.
 */
import { Pool } from 'pg';
import { MarketplaceBundleRepository } from '../marketplace-bundle-repository';
import { INTERNAL_BUNDLE_PREFIX } from '../../../agents/git-ingest/internal-bundle-fetcher';

function makePool(rows: unknown[]) {
    return { query: jest.fn().mockResolvedValue({ rows }) } as unknown as Pool;
}

describe('MarketplaceBundleRepository.loadForUser', () => {
    it('owner_id 또는 shared 게시 조건을 SQL 에 싣고 [id, userId, prefix] 를 바인딩한다', async () => {
        const pool = makePool([{ sha: 'abc', files: [{ path: 'SKILL.md', encoding: 'utf8', content: '# x' }] }]);
        const repo = new MarketplaceBundleRepository(pool);
        const loaded = await repo.loadForUser('bundle-1', 'user-7');
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/owner_id\s*=\s*\$2/);
        expect(sql).toMatch(/visibility\s*=\s*'shared'/);
        expect(sql).toMatch(/status\s*=\s*'active'/);
        expect(params).toEqual(['bundle-1', 'user-7', INTERNAL_BUNDLE_PREFIX]);
        expect(loaded?.sha).toBe('abc');
        expect(new TextDecoder().decode(loaded!.files.get('SKILL.md')!)).toBe('# x');
    });

    it('조건 불일치(행 없음)면 null', async () => {
        const repo = new MarketplaceBundleRepository(makePool([]));
        await expect(repo.loadForUser('bundle-1', 'stranger')).resolves.toBeNull();
    });

    it('무스코프 load 는 userId 를 받지 않는다 (admin/내부 전용)', async () => {
        const pool = makePool([]);
        await new MarketplaceBundleRepository(pool).load('bundle-1');
        const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
        expect(sql).not.toMatch(/owner_id/);
        expect(params).toEqual(['bundle-1']);
    });
});
