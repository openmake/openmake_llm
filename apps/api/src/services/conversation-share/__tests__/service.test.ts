/**
 * 대화 공유 조회 인가 행렬(PURE) — 서버만 판정한다. 관리자 우회·토큰으로 org 우회 없음.
 */
import { decideShareAccess, safeTokenEqual, sharePath, allowedVisibilities } from '../service';

const base = { ownerId: 'owner', tokenOk: false, ownerIsMember: false, viewerIsMember: false };

describe('decideShareAccess', () => {
    it('private — 로그인한 소유자만', () => {
        expect(decideShareAccess({ ...base, visibility: 'private', viewerId: 'owner' })).toEqual({ allowed: true, reason: 'owner' });
        expect(decideShareAccess({ ...base, visibility: 'private', viewerId: 'other' })).toEqual({ allowed: false, reason: 'not_owner' });
        expect(decideShareAccess({ ...base, visibility: 'private', viewerId: null, tokenOk: true })).toEqual({ allowed: false, reason: 'login_required' });
    });

    it('authenticated — 로그인 사용자', () => {
        expect(decideShareAccess({ ...base, visibility: 'authenticated', viewerId: 'x' }).allowed).toBe(true);
        expect(decideShareAccess({ ...base, visibility: 'authenticated', viewerId: null })).toEqual({ allowed: false, reason: 'login_required' });
    });

    it('link — 올바른 토큰 또는 로그인한 소유자', () => {
        expect(decideShareAccess({ ...base, visibility: 'link', viewerId: null, tokenOk: true })).toEqual({ allowed: true, reason: 'token' });
        expect(decideShareAccess({ ...base, visibility: 'link', viewerId: 'owner' })).toEqual({ allowed: true, reason: 'owner' });
        expect(decideShareAccess({ ...base, visibility: 'link', viewerId: 'other' })).toEqual({ allowed: false, reason: 'token_mismatch' });
        expect(decideShareAccess({ ...base, visibility: 'link', viewerId: null })).toEqual({ allowed: false, reason: 'token_mismatch' });
    });

    it('org — 열람자와 소유자 모두 현재 멤버. 토큰·소유자 신분으로 우회 불가', () => {
        expect(decideShareAccess({ ...base, visibility: 'org', viewerId: 'b', ownerIsMember: true, viewerIsMember: true })).toEqual({ allowed: true, reason: 'member' });
        expect(decideShareAccess({ ...base, visibility: 'org', viewerId: 'c', ownerIsMember: true, viewerIsMember: false })).toEqual({ allowed: false, reason: 'not_member' });
        expect(decideShareAccess({ ...base, visibility: 'org', viewerId: 'b', ownerIsMember: false, viewerIsMember: true })).toEqual({ allowed: false, reason: 'owner_not_member' });
        expect(decideShareAccess({ ...base, visibility: 'org', viewerId: null, tokenOk: true, ownerIsMember: true, viewerIsMember: true })).toEqual({ allowed: false, reason: 'login_required' });
        // 소유자라도 멤버십이 없으면 fail-closed(정상 탈퇴는 trigger 가 이미 private 로 바꾼다)
        expect(decideShareAccess({ ...base, visibility: 'org', viewerId: 'owner', ownerIsMember: false, viewerIsMember: false }).allowed).toBe(false);
        expect(decideShareAccess({ ...base, visibility: 'org', viewerId: 'owner', ownerIsMember: true, viewerIsMember: true }).allowed).toBe(true);
    });

    it('모르는 범위는 거절', () => {
        expect(decideShareAccess({ ...base, visibility: 'public' as never, viewerId: 'owner' }).allowed).toBe(false);
    });
});

describe('보조 함수', () => {
    it('safeTokenEqual — 길이·값이 같을 때만, 기대값이 없으면 거절', () => {
        expect(safeTokenEqual('abc', 'abc')).toBe(true);
        expect(safeTokenEqual('abd', 'abc')).toBe(false);
        expect(safeTokenEqual('ab', 'abc')).toBe(false);
        expect(safeTokenEqual('', null)).toBe(false);
        expect(safeTokenEqual(undefined, 'abc')).toBe(false);
    });

    it('sharePath — 같은 origin 상대 경로, link 일 때만 토큰', () => {
        expect(sharePath('id-1', null)).toBe('/shared/conversation/id-1');
        expect(sharePath('id-1', 'a_b-c')).toBe('/shared/conversation/id-1?token=a_b-c');
    });

    it('allowedVisibilities — 소속 조직이 있을 때만 org', () => {
        expect(allowedVisibilities(0)).toEqual(['private', 'authenticated', 'link']);
        expect(allowedVisibilities(2)).toEqual(['private', 'authenticated', 'link', 'org']);
    });
});
