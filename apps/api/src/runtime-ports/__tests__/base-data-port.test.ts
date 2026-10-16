/**
 * Base 데이터 포트 — actor 를 받는 함수는 그 actor 의 것만, user 가 아닌 actor 는 빈 결과(세션은 사용자만 소유한다).
 * DB 는 쓰지 않는다 — 읽기 쿼리 모듈(data/conversation-session-lookup)을 mock 한다.
 */
jest.mock('../../data/conversation-session-lookup', () => ({
    listSessionIdsByOwner: jest.fn(),
    getSessionOwnerId: jest.fn(),
    getSessionSummaries: jest.fn(),
}));
jest.mock('../../data/migrations/runner', () => ({ isMigrationApplied: jest.fn() }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => 'pool' }));

import { baseDataPort } from '../base-data-port';
import * as lookup from '../../data/conversation-session-lookup';
import * as runner from '../../data/migrations/runner';

const listSessionIdsByOwner = lookup.listSessionIdsByOwner as jest.Mock;
const getSessionOwnerId = lookup.getSessionOwnerId as jest.Mock;
const getSessionSummaries = lookup.getSessionSummaries as jest.Mock;
const sessions = baseDataPort.conversationSessions;
const user = { kind: 'user' as const, userId: 'u1' };

beforeEach(() => jest.clearAllMocks());

describe('conversationSessions.listIdsForUser', () => {
    it('user actor 는 자기 세션 id 를 받는다', async () => {
        listSessionIdsByOwner.mockResolvedValueOnce(['s1', 's2']);
        await expect(sessions.listIdsForUser(user)).resolves.toEqual(['s1', 's2']);
        expect(listSessionIdsByOwner).toHaveBeenCalledWith('u1');
    });

    it('org·system actor 는 세션을 소유하지 않는다 — 조회 없이 빈 목록', async () => {
        await expect(sessions.listIdsForUser({ kind: 'org', orgId: 'o1' })).resolves.toEqual([]);
        await expect(sessions.listIdsForUser({ kind: 'system', reason: 'test' })).resolves.toEqual([]);
        expect(listSessionIdsByOwner).not.toHaveBeenCalled();
    });
});

describe('conversationSessions.exists', () => {
    it('자기 세션이면 true', async () => {
        getSessionOwnerId.mockResolvedValueOnce('u1');
        await expect(sessions.exists(user, 's1')).resolves.toBe(true);
        expect(getSessionOwnerId).toHaveBeenCalledWith('s1');
    });

    it('남의 세션·익명 세션·없는 세션은 false', async () => {
        getSessionOwnerId.mockResolvedValueOnce('u2').mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);
        await expect(sessions.exists(user, 's1')).resolves.toBe(false);
        await expect(sessions.exists(user, 's2')).resolves.toBe(false);
        await expect(sessions.exists(user, 's3')).resolves.toBe(false);
    });

    it('user 가 아닌 actor 는 조회 없이 false', async () => {
        await expect(sessions.exists({ kind: 'system', reason: 'test' }, 's1')).resolves.toBe(false);
        expect(getSessionOwnerId).not.toHaveBeenCalled();
    });
});

describe('conversationSessions.ownerOf', () => {
    it('소유자 id 를 돌려주고, 익명·없는 세션은 null', async () => {
        getSessionOwnerId.mockResolvedValueOnce('u1').mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);
        await expect(sessions.ownerOf('s1')).resolves.toBe('u1');
        await expect(sessions.ownerOf('s2')).resolves.toBeNull();
        await expect(sessions.ownerOf('s3')).resolves.toBeNull();
    });
});

describe('conversationSessions.summaries', () => {
    it('빈 목록이면 조회하지 않는다', async () => {
        await expect(sessions.summaries([])).resolves.toEqual([]);
        expect(getSessionSummaries).not.toHaveBeenCalled();
    });

    it('제목·갱신 시각(ISO 문자열)을 Base 가 준 순서(최근 갱신 순) 그대로 돌려준다', async () => {
        getSessionSummaries.mockResolvedValueOnce([
            { id: 's2', title: null, updated_at: new Date('2026-10-16T02:00:00.000Z') },
            { id: 's1', title: '첫 대화', updated_at: new Date('2026-10-16T01:00:00.000Z') },
        ]);
        await expect(sessions.summaries(['s1', 's2'])).resolves.toEqual([
            { id: 's2', title: null, updatedAt: '2026-10-16T02:00:00.000Z' },
            { id: 's1', title: '첫 대화', updatedAt: '2026-10-16T01:00:00.000Z' },
        ]);
        expect(getSessionSummaries).toHaveBeenCalledWith(['s1', 's2']);
    });

    it('updated_at 이 NULL 인 행(컬럼이 NOT NULL 이 아니다)은 예외 없이 updatedAt null', async () => {
        getSessionSummaries.mockResolvedValueOnce([{ id: 's3', title: '옛 대화', updated_at: null }]);
        await expect(sessions.summaries(['s3'])).resolves.toEqual([{ id: 's3', title: '옛 대화', updatedAt: null }]);
    });
});

describe('migrations.isApplied', () => {
    const isMigrationApplied = runner.isMigrationApplied as jest.Mock;

    it('기록이 있으면 true — Base 풀과 version 을 그대로 넘긴다', async () => {
        isMigrationApplied.mockResolvedValueOnce(true);
        await expect(baseDataPort.migrations.isApplied('addon:knowledge-runtime:004')).resolves.toBe(true);
        expect(isMigrationApplied).toHaveBeenCalledWith('pool', 'addon:knowledge-runtime:004');
    });

    it('기록이 없으면 false', async () => {
        isMigrationApplied.mockResolvedValueOnce(false);
        await expect(baseDataPort.migrations.isApplied('addon:x:001')).resolves.toBe(false);
    });

    it('조회 실패는 삼키지 않고 던진다 — 호출부가 "없음"과 나눈다', async () => {
        isMigrationApplied.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
        await expect(baseDataPort.migrations.isApplied('addon:x:001')).rejects.toThrow('ECONNREFUSED');
    });
});
