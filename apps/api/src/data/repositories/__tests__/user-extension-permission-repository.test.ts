/**
 * 마이그레이션 190 의 모양 + UserExtensionPermissionRepository 의 SQL 파라미터 — DB 없이 늘 돈다.
 * 실제 Postgres 의미(백필·멱등·jsonb NULL·조건부 저장·MCP 왕복)는
 * apps/api/src/__tests__/data/repositories/user-extension-permission-state.db.test.ts 가 본다.
 */
import type { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { UserExtensionPermissionRepository } from '../user-extension-permission-repository';
import { EXTENSION_PERMISSION_STATES } from '../../../config/addon-permissions';

const MIGRATIONS = join(__dirname, '../../../../../../db/migrations');
const MIGRATION_FILE = '190_user_extensions_permission_state.sql';
const ROLLBACK_FILE = 'rollbacks/190_user_extensions_permission_state_rollback.sql';

/** 주석 줄을 뺀 SQL 본문 */
function sqlBody(file: string): string {
    return readFileSync(join(MIGRATIONS, file), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
}

function fakePool(rows: unknown[] = [], rowCount: number = rows.length) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
            calls.push({ sql, params });
            return { rows, rowCount };
        }),
    };
    return { pool: pool as unknown as Pool, calls };
}

describe('마이그레이션 190 — additive·멱등', () => {
    const sql = sqlBody(MIGRATION_FILE);

    it('열 다섯 개를 IF NOT EXISTS 로 더한다', () => {
        for (const col of [
            "permission_state TEXT NOT NULL DEFAULT 'legacy_unreviewed'",
            'permissions_granted JSONB',
            'permissions_requested JSONB',
            'permissions_reviewed_at TIMESTAMPTZ',
            'permissions_reviewed_by TEXT',
        ]) {
            expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
        }
    });

    it('기존 열·표를 지우거나 바꾸지 않는다', () => {
        expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE|CONSTRAINT)/i);
        expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    });

    it('CHECK 값이 코드의 상태 목록과 같다', () => {
        const m = /CHECK \(permission_state IN \(([^)]+)\)\)/.exec(sql);
        expect(m).not.toBeNull();
        const values = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
        expect(values).toEqual([...EXTENSION_PERMISSION_STATES].sort());
    });

    it('백필은 검토 기록이 없는 레거시 행 중 addonPermissions 배열이 있는 것만 건드린다(재적용 멱등)', () => {
        expect(sql).toMatch(
            /WHERE permission_state = 'legacy_unreviewed'\s+AND permissions_reviewed_at IS NULL\s+AND jsonb_typeof\(manifest->'addonPermissions'\) = 'array'/,
        );
    });

    it('되돌리기 파일이 있고 다섯 열과 CHECK 를 지운다', () => {
        expect(existsSync(join(MIGRATIONS, ROLLBACK_FILE))).toBe(true);
        const rollback = sqlBody(ROLLBACK_FILE);
        for (const col of ['permission_state', 'permissions_granted', 'permissions_requested', 'permissions_reviewed_at', 'permissions_reviewed_by']) {
            expect(rollback).toContain(`DROP COLUMN IF EXISTS ${col}`);
        }
        expect(rollback).toContain('DROP CONSTRAINT IF EXISTS user_extensions_permission_state_chk');
    });
});

describe('UserExtensionPermissionRepository — SQL 파라미터', () => {
    it('granted·requested 가 null 이면 SQL NULL 로 보낸다(jsonb \'null\' 금지)', async () => {
        const { pool, calls } = fakePool([{ id: 'e1' }]);
        await new UserExtensionPermissionRepository(pool).savePermissionState('e1', {
            state: 'legacy_unreviewed', granted: null, requested: null, reviewedBy: null,
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].params).toEqual(['e1', 'legacy_unreviewed', null, null, null]);
    });

    it('배열은 JSON 문자열로 보낸다', async () => {
        const { pool, calls } = fakePool([{ id: 'e1' }]);
        await new UserExtensionPermissionRepository(pool).savePermissionState('e1', {
            state: 'reviewed', granted: ['network:internet'], requested: [], reviewedBy: 'u1',
        });
        expect(calls[0].params).toEqual(['e1', 'reviewed', '["network:internet"]', '[]', 'u1']);
    });

    it('조건부 저장은 읽은 요청 권한과 같을 때만 쓰고, 0행이면 null', async () => {
        const { pool, calls } = fakePool([], 0);
        const saved = await new UserExtensionPermissionRepository(pool).saveReviewIfRequestedUnchanged('e1', {
            state: 'reviewed', granted: ['network:internet'], reviewedBy: 'u1', expectedRequested: null,
        });
        expect(saved).toBeNull();
        expect(calls[0].sql).toMatch(/permissions_requested IS NOT DISTINCT FROM \$5::jsonb/);
        expect(calls[0].sql).toMatch(/status = 'active'/);
        expect(calls[0].params).toEqual(['e1', 'reviewed', '["network:internet"]', 'u1', null]);
    });

    it('네트워크 제한은 stdio 와 원격을 따로 고치고 영향받은 행 수를 돌려준다', async () => {
        const { pool, calls } = fakePool([], 2);
        const res = await new UserExtensionPermissionRepository(pool).restrictLinkedMcpNetwork('e1');
        expect(res).toEqual({ sandboxed: 2, disabled: 2 });
        expect(calls[0].sql).toMatch(/transport_type = 'stdio'/);
        expect(calls[0].sql).toMatch(/networkRestrictedByPermission/);
        expect(calls[1].sql).toMatch(/transport_type <> 'stdio'/);
        expect(calls[1].sql).toMatch(/disabledByPermission/);
        expect(calls.map((c) => c.params)).toEqual([['e1'], ['e1']]);
    });

    it('네트워크 복원은 권한 표시가 있는 stdio 만 대상이다', async () => {
        const { pool, calls } = fakePool([], 1);
        expect(await new UserExtensionPermissionRepository(pool).restoreLinkedMcpNetwork('e1')).toBe(1);
        expect(calls[0].sql).toMatch(/manifest_meta->>'networkRestrictedByPermission' = 'true'/);
        expect(calls[0].sql).toMatch(/sandbox_network = 'full'/);
    });
});
