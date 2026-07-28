import { canRegisterServer, canViewServer, canDeleteServer } from '../routes/mcp-visibility';
import type { UserMcpServerRow } from '../data/repositories/mcp-catalog-repository';
import type { Actor } from '../routes/mcp-visibility';

const adminActor: Actor = { id: 'u-admin', role: 'admin' };
const userA: Actor = { id: 'u-a', role: 'user' };
const userB: Actor = { id: 'u-b', role: 'user' };

function mkServer(overrides: Partial<UserMcpServerRow>): UserMcpServerRow {
    return {
        id: 's1',
        user_id: null,
        name: 's1',
        transport_type: 'stdio',
        command: null,
        args: null,
        env: null,
        url: null,
        visibility: 'global',
        catalog_template_id: null,
        auto_spawn: true,
        enabled: true,
        created_at: '',
        updated_at: '',
        ...overrides,
    };
}

describe('canRegisterServer', () => {
    test('admin: global 등록 가능 (catalog_template_id 없어도)', () => {
        expect(canRegisterServer(adminActor, { visibility: 'global' })).toEqual({ allowed: true });
    });

    test('user: global 등록 거부', () => {
        const r = canRegisterServer(userA, { visibility: 'global' });
        expect(r.allowed).toBe(false);
        if (!r.allowed) expect(r.reason).toMatch(/global/i);
    });

    test('user: catalog_template_id 없으면 거부', () => {
        const r = canRegisterServer(userA, { visibility: 'user_private' });
        expect(r.allowed).toBe(false);
        if (!r.allowed) expect(r.reason).toMatch(/catalog/i);
    });

    test('user: catalog_template_id 있으면 user_private 허용', () => {
        const r = canRegisterServer(userA, { visibility: 'user_private', catalog_template_id: 'mcp-filesystem' });
        expect(r.allowed).toBe(true);
    });
});

describe('canViewServer', () => {
    test('global 서버는 모두 조회 가능', () => {
        expect(canViewServer(userA, mkServer({ visibility: 'global' }))).toBe(true);
        expect(canViewServer(userB, mkServer({ visibility: 'global' }))).toBe(true);
    });

    test('user_private 는 본인만', () => {
        const s = mkServer({ visibility: 'user_private', user_id: 'u-a' });
        expect(canViewServer(userA, s)).toBe(true);
        expect(canViewServer(userB, s)).toBe(false);
        expect(canViewServer(adminActor, s)).toBe(true);
    });

    test('user_shared 는 모두 조회 가능', () => {
        const s = mkServer({ visibility: 'user_shared', user_id: 'u-a' });
        expect(canViewServer(userB, s)).toBe(true);
    });
});

describe('canDeleteServer', () => {
    test('소유자만 삭제 가능', () => {
        const s = mkServer({ visibility: 'user_private', user_id: 'u-a' });
        expect(canDeleteServer(userA, s)).toBe(true);
        expect(canDeleteServer(userB, s)).toBe(false);
    });

    test('admin 은 모두 삭제 가능', () => {
        const s = mkServer({ visibility: 'user_private', user_id: 'u-a' });
        expect(canDeleteServer(adminActor, s)).toBe(true);
    });
});
