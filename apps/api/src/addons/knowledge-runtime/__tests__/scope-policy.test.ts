/**
 * scope 권한 규칙(순수) — accessPredicate·creatableScopeId. DB 없이 SQL 술어만 검증한다.
 * 조직 scope 는 활성 조직 + 쓰기 역할일 때만 write 에 들어가고, 개인 scope 는 항상 read·write 가능해야 한다.
 */
import { accessPredicate, creatableScopeId, type KnowledgeActor } from '../config/scope-policy';

const writeRoles = ['owner', 'admin'] as const;

function actor(over: Partial<KnowledgeActor> = {}): KnowledgeActor {
    return { userId: 'u1', activeOrg: null, orgWriteRoles: writeRoles, ...over };
}

describe('accessPredicate', () => {
    it('개인 scope 는 read·write 모두 user 쌍을 넣는다', () => {
        const r = accessPredicate(actor(), 'read', 's', 1);
        expect(r.params).toEqual(['user', 'u1']);
        expect(r.sql).toContain("s.status = 'active'");
        expect(r.sql).toContain('s.deleted_at IS NULL');
        const w = accessPredicate(actor(), 'write', 's', 1);
        expect(w.params).toEqual(['user', 'u1']);
    });

    it('조직 멤버(비쓰기 역할)는 read 에 조직을 넣지만 write 에는 넣지 않는다', () => {
        const a = actor({ activeOrg: { orgId: 'o1', orgRole: 'member' } });
        const read = accessPredicate(a, 'read', 's', 1);
        expect(read.params).toEqual(['user', 'u1', 'organization', 'o1']);
        const write = accessPredicate(a, 'write', 's', 1);
        expect(write.params).toEqual(['user', 'u1']); // 조직 쓰기 불가 → 개인만
    });

    it('조직 관리자는 write 에도 조직을 넣는다', () => {
        const a = actor({ activeOrg: { orgId: 'o1', orgRole: 'admin' } });
        const write = accessPredicate(a, 'write', 's', 1);
        expect(write.params).toEqual(['user', 'u1', 'organization', 'o1']);
    });

    it('startIndex 로 파라미터 번호가 이어진다($3,$4 …)', () => {
        const a = actor({ activeOrg: { orgId: 'o1', orgRole: 'owner' } });
        const r = accessPredicate(a, 'read', 's', 3);
        expect(r.sql).toContain('($3, $4)');
        expect(r.sql).toContain('($5, $6)');
    });
});

describe('creatableScopeId', () => {
    it('개인은 항상 생성 가능, 조직은 쓰기 역할일 때만', () => {
        expect(creatableScopeId(actor(), 'user')).toBe('u1');
        expect(creatableScopeId(actor({ activeOrg: { orgId: 'o1', orgRole: 'member' } }), 'organization')).toBeNull();
        expect(creatableScopeId(actor({ activeOrg: { orgId: 'o1', orgRole: 'owner' } }), 'organization')).toBe('o1');
        expect(creatableScopeId(actor(), 'organization')).toBeNull(); // 활성 조직 없음
    });
});
