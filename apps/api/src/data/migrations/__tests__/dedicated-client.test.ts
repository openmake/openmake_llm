/**
 * 마이그레이션 전용 클라이언트 (안정화, 2026-10-10).
 *
 * 공용 풀은 statement_timeout 30초가 걸려 있어 긴 백필 마이그레이션이 부팅 중 타임아웃 → exit(1) → 재시작 루프가 된다.
 * 핵심 판정:
 *  ① 마이그레이션은 풀에서 받은 **하나의** 연결에서 돌고, 그 연결의 statement_timeout 을 먼저 0 으로 푼다.
 *  ② advisory lock 획득·해제와 마이그레이션 문장이 같은 세션이다.
 *  ③ 성공·실패 어느 쪽이든 statement_timeout 을 원복하고 연결을 반납한다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Pool } from 'pg';
import { MigrationRunner, applyAddonMigrationsWithLock, applyPendingWithLock } from '../runner';

interface Call { who: string; text: string }

/** 어느 연결에서 어떤 문장이 돌았는지 순서대로 기록하는 pg Pool 스텁 */
function recordingPool(opts: { failOn?: RegExp } = {}): {
    pool: Pool;
    calls: Call[];
    releases: Array<{ who: string; arg: unknown }>;
    texts: (who: string) => string[];
} {
    const calls: Call[] = [];
    const releases: Array<{ who: string; arg: unknown }> = [];
    const applied: string[] = [];
    let seq = 0;
    const queryAs = (who: string) => async (text: string, params?: unknown[]) => {
        calls.push({ who, text });
        if (opts.failOn?.test(text)) throw new Error('SQL 실패(의도)');
        if (/^SELECT version FROM migration_versions/.test(text)) {
            return { rows: applied.map(v => ({ version: v })) };
        }
        if (/^INSERT INTO migration_versions/.test(text)) {
            applied.push(String((params ?? [])[0]));
        }
        return { rows: [] };
    };
    const pool = {
        query: queryAs('pool'),
        connect: async () => {
            const who = `client${++seq}`;
            return {
                query: queryAs(who),
                release: (arg?: unknown) => {
                    calls.push({ who, text: '<release>' });
                    releases.push({ who, arg });
                },
            };
        },
    } as unknown as Pool;
    return { pool, calls, releases, texts: (who) => calls.filter(c => c.who === who).map(c => c.text) };
}

function writeMigrations(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-mig-dedicated-'));
    for (const [file, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), sql);
    return dir;
}

/** applyPendingWithLock 은 코어 경로(cwd/db/migrations)를 읽는다 — cwd 를 임시 디렉터리로 돌린다 */
function useCoreMigrations(files: Record<string, string>): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-mig-core-'));
    const dir = path.join(root, 'db', 'migrations');
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), sql);
    jest.spyOn(process, 'cwd').mockReturnValue(root);
}

const idx = (list: string[], re: RegExp): number => list.findIndex(t => re.test(t));

const TIMEOUT_OFF = /^SET statement_timeout = 0$/;
const TIMEOUT_RESTORE = /^RESET statement_timeout$/;
const LOCK = /^SELECT pg_advisory_lock/;
const UNLOCK = /^SELECT pg_advisory_unlock/;

describe('마이그레이션 전용 클라이언트', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('부팅 경로: 한 연결에서 timeout 0 → lock → 마이그레이션 → unlock → 원복 → 반납 순으로 돈다', async () => {
        useCoreMigrations({ '001_backfill.sql': 'UPDATE big_table SET x = 1;' });
        const { pool, calls, releases, texts } = recordingPool();

        const res = await applyPendingWithLock(pool);

        expect(res.applied).toEqual(['001_backfill.sql']);
        // 모든 문장이 같은 세션 — 풀 직접 쿼리도, 두 번째 연결도 없다
        expect(new Set(calls.map(c => c.who))).toEqual(new Set(['client1']));
        const t = texts('client1');
        const order = [
            idx(t, TIMEOUT_OFF),
            idx(t, LOCK),
            idx(t, /^BEGIN$/),
            idx(t, /^UPDATE big_table/),
            idx(t, /^COMMIT$/),
            idx(t, UNLOCK),
            idx(t, TIMEOUT_RESTORE),
            idx(t, /^<release>$/),
        ];
        expect(order.every(i => i >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(releases).toHaveLength(1);
        expect(releases[0].arg).toBeFalsy();
    });

    it('부팅 경로: 마이그레이션이 실패해도 롤백·lock 해제·원복·반납이 같은 연결에서 일어난다', async () => {
        useCoreMigrations({ '001_boom.sql': 'UPDATE boom_table SET x = 1;' });
        const { pool, calls, releases, texts } = recordingPool({ failOn: /boom_table/ });

        await expect(applyPendingWithLock(pool)).rejects.toThrow('SQL 실패(의도)');

        expect(new Set(calls.map(c => c.who))).toEqual(new Set(['client1']));
        const t = texts('client1');
        const order = [
            idx(t, TIMEOUT_OFF),
            idx(t, /^UPDATE boom_table/),
            idx(t, /^ROLLBACK$/),
            idx(t, UNLOCK),
            idx(t, TIMEOUT_RESTORE),
            idx(t, /^<release>$/),
        ];
        expect(order.every(i => i >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(t.some(x => /^COMMIT$/.test(x))).toBe(false);
        expect(releases).toHaveLength(1);
    });

    it('부팅 경로: lock 을 못 얻으면 그대로 던지고(마이그레이션·unlock 없음) 원복·반납은 한다', async () => {
        useCoreMigrations({ '001_init.sql': 'CREATE TABLE never_x();' });
        const { pool, releases, texts } = recordingPool({ failOn: LOCK });

        await expect(applyPendingWithLock(pool)).rejects.toThrow('SQL 실패(의도)');

        const t = texts('client1');
        expect(t.some(x => /never_x/.test(x))).toBe(false);
        expect(t.some(x => UNLOCK.test(x))).toBe(false);
        expect(idx(t, TIMEOUT_RESTORE)).toBeGreaterThan(idx(t, LOCK));
        expect(releases).toHaveLength(1);
    });

    it('add-on 경로: 한 add-on 이 실패해도 같은 연결에서 다음 add-on 을 적용하고 lock 해제·원복·반납한다', async () => {
        const bad = writeMigrations({ '001_boom.sql': 'CREATE TABLE boom_x();' });
        const good = writeMigrations({ '001_ok.sql': 'CREATE TABLE good_x();' });
        const { pool, calls, releases, texts } = recordingPool({ failOn: /boom_x/ });

        const res = await applyAddonMigrationsWithLock(pool, [{ id: 'bad', dir: bad }, { id: 'good', dir: good }]);

        expect(res[0].error).toBeDefined();
        expect(res[1]).toEqual({ id: 'good', applied: ['001_ok.sql'] });
        expect(new Set(calls.map(c => c.who))).toEqual(new Set(['client1']));
        const t = texts('client1');
        const order = [
            idx(t, TIMEOUT_OFF),
            idx(t, LOCK),
            idx(t, /boom_x/),
            idx(t, /good_x/),
            idx(t, UNLOCK),
            idx(t, TIMEOUT_RESTORE),
            idx(t, /^<release>$/),
        ];
        expect(order.every(i => i >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(releases).toHaveLength(1);
    });

    it('CLI 경로(runner.applyPending 직접 호출)도 전용 연결에서 timeout 0 으로 돌고 원복·반납한다', async () => {
        const dir = writeMigrations({ '001_a.sql': 'CREATE TABLE a_x();', '002_b.sql': 'CREATE TABLE b_x();' });
        const { pool, calls, releases, texts } = recordingPool();

        const res = await new MigrationRunner(pool, { dir }).applyPending();

        expect(res.applied).toEqual(['001_a.sql', '002_b.sql']);
        expect(new Set(calls.map(c => c.who))).toEqual(new Set(['client1']));
        const t = texts('client1');
        expect(idx(t, TIMEOUT_OFF)).toBe(0);
        expect(idx(t, TIMEOUT_RESTORE)).toBeGreaterThan(idx(t, /b_x/));
        expect(t[t.length - 1]).toBe('<release>');
        expect(releases).toHaveLength(1);
    });

    it('CLI 경로: 실패해도 원복·반납한다', async () => {
        const dir = writeMigrations({ '001_boom.sql': 'CREATE TABLE boom_x();' });
        const { pool, releases, texts } = recordingPool({ failOn: /boom_x/ });

        await expect(new MigrationRunner(pool, { dir }).applyPending()).rejects.toThrow('SQL 실패(의도)');

        const t = texts('client1');
        expect(idx(t, TIMEOUT_RESTORE)).toBeGreaterThan(idx(t, /^ROLLBACK$/));
        expect(releases).toHaveLength(1);
    });

    it('원복에 실패하면 timeout 이 풀린 연결을 풀에 돌려놓지 않고 폐기한다(원래 오류는 가리지 않는다)', async () => {
        const dir = writeMigrations({ '001_a.sql': 'CREATE TABLE a_x();' });
        const { pool, releases } = recordingPool({ failOn: TIMEOUT_RESTORE });

        const res = await new MigrationRunner(pool, { dir }).applyPending();

        expect(res.applied).toEqual(['001_a.sql']);
        expect(releases).toEqual([{ who: 'client1', arg: true }]);
    });
});
