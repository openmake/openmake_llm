/**
 * 미리 만든 빈 세션의 첫 메시지 제목 반영(adoptFirstMessageTitle) — 실 DB(TEST_DATABASE_URL) 전용.
 * 기본 제목·메시지 0건일 때만 바뀌고, 이미 제목이 있거나 메시지가 있으면 그대로다.
 */
import { Pool } from 'pg';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

let pool: Pool;
jest.mock('../../data/models/unified-database', () => ({ getPool: () => pool }));

import { adoptFirstMessageTitle, DEFAULT_SESSION_TITLE } from '../../data/conversation-sessions';

describeOrSkip('adoptFirstMessageTitle (실 DB)', () => {
    const ids: string[] = [];
    beforeAll(() => { pool = new Pool({ connectionString: CONN, max: 1 }); });
    afterAll(async () => {
        if (ids.length) await pool.query('DELETE FROM conversation_sessions WHERE id = ANY($1)', [ids]);
        await pool.end();
    });
    const make = async (title: string) => {
        const id = `t-adopt-${Date.now()}-${ids.length}`;
        ids.push(id);
        await pool.query('INSERT INTO conversation_sessions (id, title, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())', [id, title]);
        return id;
    };

    it('기본 제목·빈 세션만 첫 메시지로 바뀐다', async () => {
        const fresh = await make(DEFAULT_SESSION_TITLE);
        expect(await adoptFirstMessageTitle(fresh, '청문 절차')).toBe(true);
        expect((await pool.query('SELECT title FROM conversation_sessions WHERE id=$1', [fresh])).rows[0].title).toBe('청문 절차');
        // 두 번째 메시지는 제목을 바꾸지 않는다(이미 기본 제목이 아니다)
        expect(await adoptFirstMessageTitle(fresh, '다른 질문')).toBe(false);
    });

    it('사용자가 지은 제목은 건드리지 않는다', async () => {
        const named = await make('내 제목');
        expect(await adoptFirstMessageTitle(named, 'x')).toBe(false);
    });
});
