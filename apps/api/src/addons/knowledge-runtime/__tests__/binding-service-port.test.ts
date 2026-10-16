/**
 * 대화 바인딩 — 세션 소유는 Base 데이터 포트로 확인하고, Knowledge SQL 은 자기 테이블만 쓴다(DB 없이 고정).
 * 결과(404·null)는 종전 JOIN 판정과 같아야 한다 — 남의 세션은 존재를 누출하지 않는다.
 */
jest.mock('../db', () => ({ kdb: jest.fn() }));
jest.mock('../config/scope-policy', () => ({
    actorFor: jest.fn(async (userId: string) => ({ userId, activeOrg: null, orgWriteRoles: [] })),
    accessPredicate: jest.fn(() => ({ sql: '(s.scope_type, s.scope_id) IN (($2, $3))', params: ['user', 'u1'] })),
}));
jest.mock('../spaces/repository', () => ({
    getSpaceScopeRow: jest.fn(async () => ({ id: 'sp1', scope_type: 'user', scope_id: 'u1', config_profile_id: null })),
    touchSpace: jest.fn(async () => undefined),
}));
jest.mock('../../../data/conversation-sessions', () => ({ createSession: jest.fn() }));
jest.mock('../../../runtime-ports/base-data-port', () => ({
    baseDataPort: { conversationSessions: { listIdsForUser: jest.fn(), exists: jest.fn(), ownerOf: jest.fn(), summaries: jest.fn() } },
}));

import * as db from '../db';
import * as scopePolicy from '../config/scope-policy';
import { baseDataPort } from '../../../runtime-ports/base-data-port';
import {
    bindExistingConversation, listBoundSessionIdsForUser, resolveBoundSpace, unbindConversation,
} from '../conversations/binding-service';

const query = jest.fn();
const port = baseDataPort.conversationSessions as unknown as Record<'listIdsForUser' | 'exists' | 'ownerOf' | 'summaries', jest.Mock>;
const sqlOf = (call: number): string => String(query.mock.calls[call][0]);
const paramsOf = (call: number): unknown[] => query.mock.calls[call][1] as unknown[];
const spaceRow = { id: 'sp1', name: 'P', icon: 'folder', instructions: '표로 답한다', config_profile_id: 'cp1' };

beforeEach(() => {
    jest.clearAllMocks();
    (db.kdb as jest.Mock).mockReturnValue({ query });
});

describe('resolveBoundSpace', () => {
    it('연결이 없으면 소유 확인 없이 null — 대부분의 턴은 쿼리 1번', async () => {
        query.mockResolvedValueOnce({ rows: [] });
        await expect(resolveBoundSpace('u1', 's1')).resolves.toBeNull();
        expect(port.exists).not.toHaveBeenCalled();
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('연결돼 있어도 남의 세션이면 null(존재를 누출하지 않는다)', async () => {
        query.mockResolvedValueOnce({ rows: [spaceRow] });
        port.exists.mockResolvedValueOnce(false);
        await expect(resolveBoundSpace('u2', 's1')).resolves.toBeNull();
        expect(port.exists).toHaveBeenCalledWith({ kind: 'user', userId: 'u2' }, 's1');
    });

    it('자기 세션이면 Space 를 돌려주고, SQL 은 Base 테이블을 쓰지 않는다', async () => {
        query.mockResolvedValueOnce({ rows: [spaceRow] });
        port.exists.mockResolvedValueOnce(true);
        await expect(resolveBoundSpace('u1', 's1')).resolves.toEqual({
            spaceId: 'sp1', name: 'P', icon: 'folder', instructions: '표로 답한다', configProfileId: 'cp1',
        });
        expect(sqlOf(0)).not.toMatch(/conversation_sessions/);
        expect(paramsOf(0)).toEqual(['s1', 'user', 'u1']);
        expect(scopePolicy.accessPredicate).toHaveBeenCalledWith(expect.anything(), 'read', 's', 2);
    });
});

describe('bindExistingConversation', () => {
    it('남의 세션은 404 이고 바인딩을 쓰지 않는다', async () => {
        port.exists.mockResolvedValueOnce(false);
        await expect(bindExistingConversation('u1', 'sp1', 's1')).rejects.toMatchObject({ statusCode: 404 });
        expect(port.exists).toHaveBeenCalledWith({ kind: 'user', userId: 'u1' }, 's1');
        expect(port.ownerOf).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });

    it('없는 세션·익명 세션도 404(포트 exists 가 false)', async () => {
        port.exists.mockResolvedValueOnce(false);
        await expect(bindExistingConversation('u1', 'sp1', 's1')).rejects.toMatchObject({ statusCode: 404 });
        expect(query).not.toHaveBeenCalled();
    });

    it('자기 세션이면 upsert 한 번, SQL 은 Base 테이블을 쓰지 않는다', async () => {
        port.exists.mockResolvedValueOnce(true);
        query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
        await expect(bindExistingConversation('u1', 'sp1', 's1')).resolves.toBeUndefined();
        expect(query).toHaveBeenCalledTimes(1);
        expect(sqlOf(0)).toMatch(/INSERT INTO knowledge_conversation_bindings/);
        expect(sqlOf(0)).not.toMatch(/conversation_sessions/);
        expect(paramsOf(0)).toEqual(['s1', 'sp1', 'u1']);
    });
});

describe('listBoundSessionIdsForUser', () => {
    it('세션이 없으면 Knowledge 쿼리도 하지 않는다', async () => {
        port.listIdsForUser.mockResolvedValueOnce([]);
        await expect(listBoundSessionIdsForUser('u1')).resolves.toEqual([]);
        expect(query).not.toHaveBeenCalled();
    });

    it('자기 세션 중 연결된 것만 — 한 번의 ANY 쿼리', async () => {
        port.listIdsForUser.mockResolvedValueOnce(['s1', 's2', 's3']);
        query.mockResolvedValueOnce({ rows: [{ session_id: 's2' }] });
        await expect(listBoundSessionIdsForUser('u1')).resolves.toEqual(['s2']);
        expect(port.listIdsForUser).toHaveBeenCalledWith({ kind: 'user', userId: 'u1' });
        expect(query).toHaveBeenCalledTimes(1);
        expect(sqlOf(0)).toMatch(/session_id = ANY\(\$1::text\[\]\)/);
        expect(sqlOf(0)).not.toMatch(/conversation_sessions/);
        expect(paramsOf(0)).toEqual([['s1', 's2', 's3']]);
    });
});

describe('unbindConversation', () => {
    it('남의 세션은 404 이고 지우지 않는다', async () => {
        port.exists.mockResolvedValueOnce(false);
        await expect(unbindConversation('u1', 's1')).rejects.toMatchObject({ statusCode: 404 });
        expect(query).not.toHaveBeenCalled();
    });

    it('자기 세션이지만 연결이 없으면 404', async () => {
        port.exists.mockResolvedValueOnce(true);
        query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
        await expect(unbindConversation('u1', 's1')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('자기 세션의 연결을 지운다 — SQL 은 Base 테이블을 쓰지 않는다', async () => {
        port.exists.mockResolvedValueOnce(true);
        query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
        await expect(unbindConversation('u1', 's1')).resolves.toBeUndefined();
        expect(sqlOf(0)).toMatch(/DELETE FROM knowledge_conversation_bindings/);
        expect(sqlOf(0)).not.toMatch(/conversation_sessions/);
        expect(paramsOf(0)).toEqual(['s1']);
    });
});
