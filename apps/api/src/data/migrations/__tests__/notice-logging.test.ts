/**
 * 마이그레이션 NOTICE → 서버 로그 (2026-10-25, 193 데이터 정리 건수 기록용).
 *
 * 핵심 판정:
 *  ① 마이그레이션 SQL 실행 중 연결이 받은 NOTICE 가 logger.info 로 남는다.
 *  ② 성공·실패 어느 쪽이든 실행이 끝나면 notice 리스너를 뗀다(풀로 돌아간 연결에 리스너가 쌓이지 않는다).
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Pool, PoolClient } from 'pg';

const info = jest.fn();
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ info, warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { MigrationRunner } from '../runner';

function migrationsDir(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-mig-notice-'));
    for (const [file, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), sql);
    return dir;
}

/** NOTICE 를 내는 SQL 이면 실행 중 'notice' 이벤트를 쏘는 연결 스텁 */
function noticeClient(opts: { failOn?: RegExp } = {}): PoolClient & EventEmitter {
    const client = new EventEmitter() as PoolClient & EventEmitter;
    (client as unknown as { query: unknown }).query = async (text: string) => {
        if (/RAISE NOTICE/.test(text)) client.emit('notice', { message: '[t] removed: keys=2' });
        if (opts.failOn?.test(text)) throw new Error('SQL 실패(의도)');
        return { rows: [] };
    };
    return client;
}

describe('마이그레이션 NOTICE 로그', () => {
    beforeEach(() => info.mockClear());

    it('NOTICE 메시지를 info 로 남기고 끝나면 리스너를 뗀다', async () => {
        const dir = migrationsDir({ '001_cleanup.sql': "DO $$ BEGIN RAISE NOTICE 'x'; END$$;" });
        const client = noticeClient();
        const runner = new MigrationRunner({} as Pool, { dir });

        const res = await runner.applyPending(client);

        expect(res.applied).toEqual(['001_cleanup.sql']);
        expect(info).toHaveBeenCalledWith('migration notice: [t] removed: keys=2');
        expect(client.listenerCount('notice')).toBe(0);
    });

    it('마이그레이션이 실패해도 리스너를 뗀다', async () => {
        const dir = migrationsDir({ '001_boom.sql': "DO $$ BEGIN RAISE NOTICE 'x'; END$$; -- boom" });
        const client = noticeClient({ failOn: /boom/ });
        const runner = new MigrationRunner({} as Pool, { dir });

        await expect(runner.applyPending(client)).rejects.toThrow('SQL 실패(의도)');
        expect(client.listenerCount('notice')).toBe(0);
    });
});
