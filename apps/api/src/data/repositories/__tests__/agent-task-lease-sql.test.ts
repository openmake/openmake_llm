/**
 * 실행 소유권 판별 SQL 조각(#1473) — 사용처에 복사돼 있던 문자열과 바이트가 같아야 한다.
 */
import { claimableLeaseSql, expiredLeaseSql, orphanedClaimSql } from '../agent-task-lease-sql';
import { expiredLeaseSql as reExported } from '../agent-task-lease-repository';

describe('agent-task-lease-sql (#1473)', () => {
    it('expiredLeaseSql — 기본 컬럼과 별칭 컬럼', () => {
        expect(expiredLeaseSql()).toBe('lease_until IS NOT NULL AND lease_until < NOW()');
        expect(expiredLeaseSql('t.lease_until')).toBe('t.lease_until IS NOT NULL AND t.lease_until < NOW()');
    });

    it('lease-repository 의 re-export 는 같은 함수다(기존 import 유지)', () => {
        expect(reExported).toBe(expiredLeaseSql);
    });

    it('claimableLeaseSql — 자리표시자와 리터럴 owner', () => {
        expect(claimableLeaseSql('$2')).toBe('(lease_owner IS NULL OR lease_owner = $2 OR lease_until < NOW())');
        expect(claimableLeaseSql("'host:1'")).toBe("(lease_owner IS NULL OR lease_owner = 'host:1' OR lease_until < NOW())");
    });

    it('orphanedClaimSql — 테이블 컬럼과 FOR UPDATE 서브쿼리 별칭', () => {
        expect(orphanedClaimSql('status', 'lease_until')).toBe("(status = 'pending' AND lease_until IS NOT NULL)");
        expect(orphanedClaimSql('o.prev', 'o.lease_until')).toBe("(o.prev = 'pending' AND o.lease_until IS NOT NULL)");
    });
});
