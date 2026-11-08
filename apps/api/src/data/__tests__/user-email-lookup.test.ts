/**
 * 사용자 이메일 조회(Base 데이터 포트 users.emailsByIds 의 쿼리) — DB 는 쓰지 않고 풀을 mock 한다.
 */
const query = jest.fn();
jest.mock('../models/unified-database', () => ({ getPool: () => ({ query }) }));

import { getUserEmails } from '../user-email-lookup';

beforeEach(() => jest.clearAllMocks());

describe('getUserEmails', () => {
    it('빈 입력이면 조회하지 않고 빈 Map', async () => {
        await expect(getUserEmails([])).resolves.toEqual(new Map());
        expect(query).not.toHaveBeenCalled();
    });

    it('id 배열 하나로 조회하고, 이메일이 없는 사용자는 뺀다', async () => {
        query.mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'a@example.com' }, { id: 'u2', email: null }] });
        await expect(getUserEmails(['u1', 'u2', 'u3'])).resolves.toEqual(new Map([['u1', 'a@example.com']]));
        expect(query).toHaveBeenCalledWith('SELECT id, email FROM users WHERE id = ANY($1::text[])', [['u1', 'u2', 'u3']]);
    });
});
