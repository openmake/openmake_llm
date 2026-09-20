/**
 * Add-on 전용 스키마 네임스페이스 (§10-5, 2026-09-19).
 *
 * 핵심 판정 둘:
 *  ① add-on 마이그레이션의 version 은 `addon:<id>:NNN` — 코어 순번(001, 002…)과 절대 충돌하지 않는다.
 *  ② 한 add-on 의 실패가 다른 add-on 과 부팅을 막지 않는다(fail-open).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Pool } from 'pg';
import { MigrationRunner, applyAddonMigrationsWithLock } from '../runner';

/** 적용된 version 을 기억하는 최소 pg Pool 스텁 */
function fakePool(opts: { failOn?: RegExp } = {}): { pool: Pool; applied: string[]; sqls: string[] } {
    const applied: string[] = [];
    const sqls: string[] = [];
    const query = async (text: string, params?: unknown[]) => {
        if (/^SELECT version FROM migration_versions/.test(text)) {
            return { rows: applied.map(v => ({ version: v })) };
        }
        if (/^INSERT INTO migration_versions/.test(text)) {
            applied.push(String((params ?? [])[0]));
            return { rows: [] };
        }
        if (/^(CREATE TABLE IF NOT EXISTS migration_versions|BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory)/.test(text)) {
            return { rows: [] };
        }
        if (opts.failOn?.test(text)) throw new Error('SQL 실패(의도)');
        sqls.push(text);
        return { rows: [] };
    };
    const client = { query, release: () => { /* noop */ } };
    const pool = { query, connect: async () => client } as unknown as Pool;
    return { pool, applied, sqls };
}

function writePack(name: string, files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omk-addon-mig-${name}-`));
    const migrations = path.join(dir, 'migrations');
    fs.mkdirSync(migrations);
    for (const [file, sql] of Object.entries(files)) fs.writeFileSync(path.join(migrations, file), sql);
    return migrations;
}

describe('add-on 마이그레이션 네임스페이스', () => {
    it('version 에 addon:<id> 접두가 붙어 코어 순번과 충돌하지 않는다', async () => {
        const dir = writePack('alpha', { '001_init.sql': 'CREATE TABLE alpha_x();' });
        const { pool, applied, sqls } = fakePool();

        const res = await applyAddonMigrationsWithLock(pool, [{ id: 'alpha-pack', dir }]);

        expect(res).toEqual([{ id: 'alpha-pack', applied: ['001_init.sql'] }]);
        expect(applied).toEqual(['addon:alpha-pack:001']);
        expect(sqls).toContain('CREATE TABLE alpha_x();');
    });

    it('같은 순번을 쓰는 두 add-on 이 서로를 건너뛰지 않는다', async () => {
        const a = writePack('a', { '001_init.sql': 'CREATE TABLE a_x();' });
        const b = writePack('b', { '001_init.sql': 'CREATE TABLE b_x();' });
        const { pool, applied } = fakePool();

        await applyAddonMigrationsWithLock(pool, [{ id: 'pack-a', dir: a }, { id: 'pack-b', dir: b }]);

        expect(applied).toEqual(['addon:pack-a:001', 'addon:pack-b:001']);
    });

    it('이미 적용된 add-on 마이그레이션은 건너뛴다(재부팅 멱등)', async () => {
        const dir = writePack('idem', { '001_init.sql': 'CREATE TABLE idem_x();' });
        const { pool, applied } = fakePool();

        await applyAddonMigrationsWithLock(pool, [{ id: 'idem-pack', dir }]);
        const second = await applyAddonMigrationsWithLock(pool, [{ id: 'idem-pack', dir }]);

        expect(second[0].applied).toEqual([]);
        expect(applied).toEqual(['addon:idem-pack:001']);
    });

    it('한 add-on 의 실패는 다른 add-on 을 막지 않는다(fail-open)', async () => {
        const bad = writePack('bad', { '001_boom.sql': 'CREATE TABLE boom_x();' });
        const good = writePack('good', { '001_ok.sql': 'CREATE TABLE good_x();' });
        const { pool, applied } = fakePool({ failOn: /boom_x/ });

        const res = await applyAddonMigrationsWithLock(pool, [{ id: 'bad-pack', dir: bad }, { id: 'good-pack', dir: good }]);

        expect(res[0].error).toBeDefined();
        expect(res[1]).toEqual({ id: 'good-pack', applied: ['001_ok.sql'] });
        expect(applied).toEqual(['addon:good-pack:001']);
    });

    it('코어 실행기는 접두 없는 version 을 그대로 쓴다(기존 행 호환)', async () => {
        const dir = writePack('core-like', { '123_core.sql': 'CREATE TABLE core_x();' });
        const { pool, applied } = fakePool();

        await new MigrationRunner(pool, { dir }).applyPending();

        expect(applied).toEqual(['123']);
    });
});
