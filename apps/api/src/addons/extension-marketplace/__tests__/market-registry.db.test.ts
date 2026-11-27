/**
 * 팩 마이그레이션 addon:extension-marketplace:002 + 레지스트리 사본 저장소 — 실 DB(TEST_DATABASE_URL 없으면 skip).
 *  ① 002 멱등 ② 최신 판만 새 행·판 교체(판이 바뀌면 큐레이션 pending) ③ 최신 아닌 판은 같은 판일 때만 상태 반영
 *  ④ deleted → tombstone(목록 제외, 승인 불가), 되살아나면 해제 ⑤ 동기화 상태 패치(커서 비우기 포함)
 * 이 테스트만의 source_id 로 쓰고 그 행만 지운다.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { RegistryRepository } from '../registry/registry-repository';
import { parseRegistryItem, type RegistryEntry } from '../registry/server-json';
import { registryItem } from './registry-fixtures';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const pool = CONN ? new Pool({ connectionString: CONN, max: 3 }) : (null as unknown as Pool);

const MIGRATION_002 = resolve(__dirname, '../../../../addons/builtin/extension-marketplace/migrations/002_market_registry_entries.sql');

function entry(over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}): RegistryEntry {
    const r = parseRegistryItem(registryItem(over, meta));
    if (!r.ok) throw new Error('fixture');
    return r.entry;
}

describeOrSkip('market_registry_entries (실 DB)', () => {
    const source = `test-${randomUUID()}`;
    const repo = () => new RegistryRepository(pool, source);

    beforeAll(async () => {
        const sql = readFileSync(MIGRATION_002, 'utf8');
        await pool.query(sql);
        await pool.query(sql);   // 멱등
    });
    afterAll(async () => {
        await pool.query('DELETE FROM market_registry_entries WHERE source_id = $1', [source]);
        await pool.query('DELETE FROM market_registry_sync_state WHERE source_id = $1', [source]);
        await pool.end();
    });

    it('최신 판 삽입 → 같은 판 갱신, 큐레이션 유지 → 새 판이면 pending 으로 되돌린다', async () => {
        expect(await repo().applyEntry(entry())).toBe('inserted');
        expect(await repo().setCuration('io.github.acme/weather', 'approved', '1')).toBe(true);
        expect(await repo().applyEntry(entry({ description: '바뀐 설명' }))).toBe('updated');
        expect(await repo().get('io.github.acme/weather')).toMatchObject({ curation: 'approved', description: '바뀐 설명' });
        await repo().applyEntry(entry({ version: '2.0.0', remotes: [{ type: 'streamable-http', url: 'https://evil.example/mcp' }] }));
        expect(await repo().get('io.github.acme/weather')).toMatchObject({ version: '2.0.0', curation: 'pending', curatedAt: null });
    });

    it('최신이 아닌 판 — 저장된 판과 같을 때만 상태를 고치고, 새 행은 만들지 않는다', async () => {
        expect(await repo().applyEntry(entry({ name: 'io.github.acme/old', version: '0.1.0' }, { isLatest: false }))).toBe('ignored');
        expect(await repo().get('io.github.acme/old')).toBeNull();
        expect(await repo().applyEntry(entry({ version: '1.2.0' }, { isLatest: false, status: 'deprecated' }))).toBe('ignored');
        expect(await repo().applyEntry(entry({ version: '2.0.0' }, { isLatest: false, status: 'deprecated', statusMessage: 'v3 로' }))).toBe('updated');
        expect(await repo().get('io.github.acme/weather')).toMatchObject({ status: 'deprecated', statusMessage: 'v3 로' });
    });

    it('deleted → tombstone: 목록에서 빠지고 승인 불가, 되살아나면 해제', async () => {
        await repo().applyEntry(entry({ version: '2.0.0' }, { status: 'deleted' }));
        const got = await repo().get('io.github.acme/weather');
        expect(got?.tombstonedAt).not.toBeNull();
        expect((await repo().list({ curation: 'all', limit: 50, offset: 0 })).entries.map(e => e.serverName)).not.toContain('io.github.acme/weather');
        expect((await repo().list({ curation: 'all', includeTombstoned: true, limit: 50, offset: 0 })).total).toBe(1);
        expect(await repo().setCuration('io.github.acme/weather', 'approved', '1')).toBe(false);
        expect(await repo().setCuration('io.github.acme/weather', 'hidden', '1')).toBe(true);
        expect((await repo().counts()).tombstoned).toBe(1);
        await repo().applyEntry(entry({ version: '2.0.0' }));
        expect((await repo().get('io.github.acme/weather'))?.tombstonedAt).toBeNull();
    });

    it('검색은 이름·제목·설명, LIKE 와일드카드는 글자로', async () => {
        await repo().applyEntry(entry({ name: 'com.example/percent', title: '100% sure' }));
        expect((await repo().list({ curation: 'all', search: '100%', limit: 50, offset: 0 })).entries.map(e => e.serverName)).toEqual(['com.example/percent']);
        expect((await repo().list({ curation: 'all', search: '%', limit: 50, offset: 0 })).entries.map(e => e.serverName)).toEqual(['com.example/percent']);
    });

    it('동기화 상태 — 없으면 기본값, 패치·커서 비우기', async () => {
        expect(await repo().getState()).toMatchObject({ cursor: null, failureCount: 0, lastStats: {} });
        await repo().patchState({ cursor: 'c1', runStartedAt: '2026-11-28T00:00:00.000Z', lastStats: { received: 3 } });
        expect(await repo().getState()).toMatchObject({ cursor: 'c1', runStartedAt: '2026-11-28T00:00:00.000Z', lastStats: { received: 3 } });
        await repo().patchState({ cursor: null, failureCount: 2, lastError: 'HTTP 503' });
        expect(await repo().getState()).toMatchObject({ cursor: null, failureCount: 2, lastError: 'HTTP 503', runStartedAt: '2026-11-28T00:00:00.000Z' });
    });
});
