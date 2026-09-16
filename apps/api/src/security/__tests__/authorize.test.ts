/**
 * 리소스 권한 판정 매트릭스 (F22 Phase A-2) — config/resource-policy 표를 바꾸면 여기가 먼저 깨진다.
 */
import { canAccess, subjectsOf, assertCanAccess } from '../authorize';
import { AuthorizationError } from '../../utils/error-handler';

const R = { ownerId: 'u-owner', orgId: 'o1', visibility: 'private' };
const actors = {
    admin:      { userId: 'u-x', role: 'admin' },
    owner:      { userId: 'u-owner', role: 'user' },
    orgOwner:   { userId: 'u-a', role: 'user', orgId: 'o1', orgRole: 'owner' as const },
    orgAdmin:   { userId: 'u-b', role: 'user', orgId: 'o1', orgRole: 'admin' as const },
    orgMember:  { userId: 'u-c', role: 'user', orgId: 'o1', orgRole: 'member' as const },
    otherOrg:   { userId: 'u-d', role: 'user', orgId: 'o2', orgRole: 'owner' as const },
    stranger:   { userId: 'u-e', role: 'user' },
    guest:      { userId: undefined, role: 'guest' },
};

describe('canAccess 매트릭스 (조직 공유 자원, DEFAULT 정책)', () => {
    const cases: Array<[keyof typeof actors, boolean, boolean, boolean]> = [
        //            read   write  delete
        ['admin',     true,  true,  true],
        ['owner',     true,  true,  true],
        ['orgOwner',  true,  true,  true],
        ['orgAdmin',  true,  true,  false],
        ['orgMember', true,  false, false],
        ['otherOrg',  false, false, false],
        ['stranger',  false, false, false],
        ['guest',     false, false, false],
    ];
    test.each(cases)('%s → read=%s write=%s delete=%s', (who, r, w, d) => {
        expect(canAccess('user_agent', 'read', R, actors[who])).toBe(r);
        expect(canAccess('user_agent', 'write', R, actors[who])).toBe(w);
        expect(canAccess('user_agent', 'delete', R, actors[who])).toBe(d);
    });
});

describe('개인 자원(agent_task) 은 조직 역할을 무시한다', () => {
    test('org owner 라도 읽기 불가, 소유자·admin 만', () => {
        expect(canAccess('agent_task', 'read', R, actors.orgOwner)).toBe(false);
        expect(canAccess('agent_task', 'read', R, actors.owner)).toBe(true);
        expect(canAccess('agent_task', 'read', R, actors.admin)).toBe(true);
    });
});

describe('인스턴스 공유(visibility shared) 는 읽기 전용', () => {
    const shared = { ownerId: 'u-owner', orgId: null, visibility: 'shared' };
    test('타인이 읽기는 되고 쓰기·삭제는 안 된다', () => {
        expect(canAccess('user_agent', 'read', shared, actors.stranger)).toBe(true);
        expect(canAccess('user_agent', 'write', shared, actors.stranger)).toBe(false);
        expect(canAccess('user_agent', 'delete', shared, actors.stranger)).toBe(false);
    });
});

describe('빈 id 방어 (2026-09-02 L4)', () => {
    test.each([['', ''], ['undefined', 'undefined'], [null, null], [undefined, undefined]])('(%j, %j) 는 소유자가 아니다', (o, u) => {
        expect(subjectsOf({ ownerId: o as string }, { userId: u as string, role: 'user' }).has('owner')).toBe(false);
    });
    test('조직 id 가 비면 조직 주체가 생기지 않는다', () => {
        expect(subjectsOf({ ownerId: 'x', orgId: null }, { userId: 'y', role: 'user', orgId: 'o1', orgRole: 'owner' }).size).toBe(0);
        expect(subjectsOf({ ownerId: 'x', orgId: 'o1' }, { userId: 'y', role: 'user', orgId: null, orgRole: 'owner' }).size).toBe(0);
    });
});

describe('assertCanAccess', () => {
    test('거부 시 AuthorizationError 를 던진다', () => {
        expect(() => assertCanAccess('user_agent', 'write', R, actors.orgMember)).toThrow(AuthorizationError);
        expect(() => assertCanAccess('user_agent', 'write', R, actors.orgAdmin)).not.toThrow();
    });
});
